#![no_std]

//! Patient-controlled consent and access management.
//!
//! The contract records access requests, patient decisions, scopes, expiry, and
//! revocation. It cross-checks the passport and provider registries so a
//! suspended or revoked provider/passport cannot retain active access.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    BytesN, Env, Vec,
};

const TTL_THRESHOLD: u32 = 2_592_000;
const TTL_BUMP: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordScope {
    AllRecords = 0,
    LabResultsOnly = 1,
    PrescriptionsOnly = 2,
    VaccinationRecordsOnly = 3,
    EmergencySummaryOnly = 4,
    InsuranceDataOnly = 5,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AccessStatus {
    Pending = 0,
    Approved = 1,
    Rejected = 2,
    Revoked = 3,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessRequest {
    pub access_id: u64,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
    pub record_scope: RecordScope,
    pub purpose_hash: BytesN<32>,
    pub requested_duration: u64,
    pub status: AccessStatus,
    pub created_at: u64,
    pub decided_at: u64,
    pub expires_at: u64,
}

#[contractevent(topics = ["access", "request"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessRequested {
    #[topic]
    pub access_id: u64,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
}

#[contractevent(topics = ["access", "approved"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessApproved {
    #[topic]
    pub access_id: u64,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
}

#[contractevent(topics = ["access", "rejected"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessRejected {
    #[topic]
    pub access_id: u64,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
}

#[contractevent(topics = ["access", "revoked"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccessRevoked {
    #[topic]
    pub access_id: u64,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    PassportRegistry,
    ProviderRegistry,
    Access(u64),
    PatientAccess(BytesN<32>),
    NextAccessId,
}

#[contractclient(name = "PassportRegistryViewClient")]
pub trait PassportRegistryView {
    fn is_passport_active(env: Env, passport_id: BytesN<32>) -> bool;
    fn is_passport_controller(env: Env, passport_id: BytesN<32>, controller: Address) -> bool;
}

#[contractclient(name = "ProviderRegistryViewClient")]
pub trait ProviderRegistryView {
    fn is_provider_verified(env: Env, provider_id: BytesN<32>) -> bool;
    fn is_provider_operator(env: Env, provider_id: BytesN<32>, operator: Address) -> bool;
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    InvalidDuration = 4,
    ProviderNotVerified = 5,
    ProviderOperatorMismatch = 6,
    PassportNotActive = 7,
    NotPassportController = 8,
    RequestNotFound = 9,
    InvalidStatus = 10,
    DurationExceedsRequest = 11,
}

#[contract]
pub struct ConsentAccessManager;

#[contractimpl]
impl ConsentAccessManager {
    pub fn initialize(
        env: Env,
        admin: Address,
        passport_registry: Address,
        provider_registry: Address,
    ) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }

        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage()
            .instance()
            .set(&DataKey::PassportRegistry, &passport_registry);
        env.storage()
            .instance()
            .set(&DataKey::ProviderRegistry, &provider_registry);
        bump_instance(&env);
        Ok(())
    }

    /// Creates a pending access request. The provider operator must be the
    /// wallet bound to a currently verified provider.
    pub fn request_access(
        env: Env,
        provider_operator: Address,
        provider_id: BytesN<32>,
        passport_id: BytesN<32>,
        record_scope: RecordScope,
        purpose_hash: BytesN<32>,
        requested_duration: u64,
    ) -> Result<u64, Error> {
        provider_operator.require_auth();

        if requested_duration == 0 {
            return Err(Error::InvalidDuration);
        }

        let (passport_registry, provider_registry) = read_registries(&env)?;
        let provider_client = ProviderRegistryViewClient::new(&env, &provider_registry);
        if !provider_client.is_provider_verified(&provider_id) {
            return Err(Error::ProviderNotVerified);
        }
        if !provider_client.is_provider_operator(&provider_id, &provider_operator) {
            return Err(Error::ProviderOperatorMismatch);
        }

        let passport_client = PassportRegistryViewClient::new(&env, &passport_registry);
        if !passport_client.is_passport_active(&passport_id) {
            return Err(Error::PassportNotActive);
        }

        let access_id = next_access_id(&env);
        let now = env.ledger().timestamp();
        let request = AccessRequest {
            access_id,
            passport_id: passport_id.clone(),
            provider_id: provider_id.clone(),
            record_scope,
            purpose_hash,
            requested_duration,
            status: AccessStatus::Pending,
            created_at: now,
            decided_at: 0,
            expires_at: 0,
        };

        write_access(&env, &request);
        append_patient_access(&env, &passport_id, access_id);

        AccessRequested {
            access_id,
            passport_id,
            provider_id,
        }
        .publish(&env);
        Ok(access_id)
    }

    /// Approves a pending request. The patient may grant a shorter window than
    /// requested, but never a longer one.
    pub fn approve_access(
        env: Env,
        passport_controller: Address,
        access_id: u64,
        approved_duration: u64,
    ) -> Result<(), Error> {
        passport_controller.require_auth();

        if approved_duration == 0 {
            return Err(Error::InvalidDuration);
        }

        let mut request = read_access(&env, access_id)?;
        if request.status != AccessStatus::Pending {
            return Err(Error::InvalidStatus);
        }

        let passport_registry = read_passport_registry(&env)?;
        let passport_client = PassportRegistryViewClient::new(&env, &passport_registry);
        if !passport_client.is_passport_controller(&request.passport_id, &passport_controller) {
            return Err(Error::NotPassportController);
        }

        let provider_registry = read_provider_registry(&env)?;
        let provider_client = ProviderRegistryViewClient::new(&env, &provider_registry);
        if !provider_client.is_provider_verified(&request.provider_id) {
            return Err(Error::ProviderNotVerified);
        }
        if approved_duration > request.requested_duration {
            return Err(Error::DurationExceedsRequest);
        }

        let now = env.ledger().timestamp();
        request.status = AccessStatus::Approved;
        request.decided_at = now;
        request.expires_at = now + approved_duration;
        write_access(&env, &request);

        AccessApproved {
            access_id,
            passport_id: request.passport_id,
            provider_id: request.provider_id,
        }
        .publish(&env);
        Ok(())
    }

    pub fn reject_access(
        env: Env,
        passport_controller: Address,
        access_id: u64,
    ) -> Result<(), Error> {
        passport_controller.require_auth();

        let mut request = read_access(&env, access_id)?;
        if request.status != AccessStatus::Pending {
            return Err(Error::InvalidStatus);
        }
        require_passport_controller(&env, &request.passport_id, &passport_controller)?;

        request.status = AccessStatus::Rejected;
        request.decided_at = env.ledger().timestamp();
        write_access(&env, &request);

        AccessRejected {
            access_id,
            passport_id: request.passport_id,
            provider_id: request.provider_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Revokes a pending or approved request immediately.
    pub fn revoke_access(
        env: Env,
        passport_controller: Address,
        access_id: u64,
    ) -> Result<(), Error> {
        passport_controller.require_auth();

        let mut request = read_access(&env, access_id)?;
        if request.status == AccessStatus::Revoked {
            return Ok(());
        }
        if request.status == AccessStatus::Rejected {
            return Err(Error::InvalidStatus);
        }
        require_passport_controller(&env, &request.passport_id, &passport_controller)?;

        request.status = AccessStatus::Revoked;
        request.decided_at = env.ledger().timestamp();
        write_access(&env, &request);

        AccessRevoked {
            access_id,
            passport_id: request.passport_id,
            provider_id: request.provider_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Authoritative access check for the off-chain gateway and other contracts.
    ///
    /// Returns false if the passport is no longer active or the provider is no
    /// longer verified, even if an unexpired grant exists.
    pub fn check_access(
        env: Env,
        passport_id: BytesN<32>,
        provider_id: BytesN<32>,
        record_scope: RecordScope,
    ) -> bool {
        let Ok((passport_registry, provider_registry)) = read_registries(&env) else {
            return false;
        };

        let passport_client = PassportRegistryViewClient::new(&env, &passport_registry);
        if !passport_client.is_passport_active(&passport_id) {
            return false;
        }

        let provider_client = ProviderRegistryViewClient::new(&env, &provider_registry);
        if !provider_client.is_provider_verified(&provider_id) {
            return false;
        }

        let now = env.ledger().timestamp();
        for access_id in read_patient_access(&env, &passport_id) {
            let Some(request) = read_access_optional(&env, access_id) else {
                continue;
            };
            let scope_matches = request.record_scope == record_scope
                || request.record_scope == RecordScope::AllRecords;
            if request.provider_id == provider_id && is_active(&request, now) && scope_matches {
                return true;
            }
        }
        false
    }

    pub fn get_access(env: Env, access_id: u64) -> Option<AccessRequest> {
        read_access_optional(&env, access_id)
    }

    pub fn get_patient_access_ids(env: Env, passport_id: BytesN<32>) -> Vec<u64> {
        read_patient_access(&env, &passport_id)
    }

    pub fn get_active_permissions(env: Env, passport_id: BytesN<32>) -> Vec<AccessRequest> {
        let now = env.ledger().timestamp();
        let mut active = Vec::new(&env);
        for access_id in read_patient_access(&env, &passport_id) {
            if let Some(request) = read_access_optional(&env, access_id) {
                if is_active(&request, now) {
                    active.push_back(request);
                }
            }
        }
        active
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        read_admin(&env)
    }

    pub fn get_registries(env: Env) -> Result<(Address, Address), Error> {
        read_registries(&env)
    }

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        Ok(())
    }
}

fn is_active(request: &AccessRequest, now: u64) -> bool {
    request.status == AccessStatus::Approved && request.expires_at > now
}

fn read_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn require_admin(env: &Env, admin: &Address) -> Result<(), Error> {
    admin.require_auth();
    if read_admin(env)? != *admin {
        return Err(Error::NotAdmin);
    }
    Ok(())
}

fn read_registries(env: &Env) -> Result<(Address, Address), Error> {
    let passport = env
        .storage()
        .instance()
        .get(&DataKey::PassportRegistry)
        .ok_or(Error::NotInitialized)?;
    let provider = env
        .storage()
        .instance()
        .get(&DataKey::ProviderRegistry)
        .ok_or(Error::NotInitialized)?;
    Ok((passport, provider))
}

fn read_passport_registry(env: &Env) -> Result<Address, Error> {
    read_registries(env).map(|(passport, _)| passport)
}

fn read_provider_registry(env: &Env) -> Result<Address, Error> {
    read_registries(env).map(|(_, provider)| provider)
}

fn require_passport_controller(
    env: &Env,
    passport_id: &BytesN<32>,
    controller: &Address,
) -> Result<(), Error> {
    let passport_registry = read_passport_registry(env)?;
    let client = PassportRegistryViewClient::new(env, &passport_registry);
    if !client.is_passport_controller(passport_id, controller) {
        return Err(Error::NotPassportController);
    }
    Ok(())
}

fn next_access_id(env: &Env) -> u64 {
    let next = env
        .storage()
        .instance()
        .get(&DataKey::NextAccessId)
        .unwrap_or(0u64);
    let following = next + 1;
    env.storage()
        .instance()
        .set(&DataKey::NextAccessId, &following);
    bump_instance(env);
    next
}

fn read_access(env: &Env, access_id: u64) -> Result<AccessRequest, Error> {
    read_access_optional(env, access_id).ok_or(Error::RequestNotFound)
}

fn read_access_optional(env: &Env, access_id: u64) -> Option<AccessRequest> {
    let key = DataKey::Access(access_id);
    let request = env.storage().persistent().get(&key);
    if request.is_some() {
        bump(env, &key);
    }
    request
}

fn write_access(env: &Env, request: &AccessRequest) {
    let key = DataKey::Access(request.access_id);
    env.storage().persistent().set(&key, request);
    bump(env, &key);
}

fn read_patient_access(env: &Env, passport_id: &BytesN<32>) -> Vec<u64> {
    let key = DataKey::PatientAccess(passport_id.clone());
    let ids = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));
    if !ids.is_empty() {
        bump(env, &key);
    }
    ids
}

fn append_patient_access(env: &Env, passport_id: &BytesN<32>, access_id: u64) {
    let key = DataKey::PatientAccess(passport_id.clone());
    let mut ids = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<u64>>(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(access_id);
    env.storage().persistent().set(&key, &ids);
    bump(env, &key);
}

fn bump(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_BUMP);
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(TTL_THRESHOLD, TTL_BUMP);
}

#[cfg(test)]
mod test {
    use super::*;
    use patient_passport_registry::{PatientPassportRegistry, PatientPassportRegistryClient};
    use provider_registry::{ProviderRegistry, ProviderRegistryClient, ProviderType};
    use soroban_sdk::{
        symbol_short, testutils::Address as _, testutils::Ledger, Address, BytesN, Env,
    };

    fn hash(env: &Env, value: u8) -> BytesN<32> {
        BytesN::from_array(env, &[value; 32])
    }

    struct Fixture {
        env: Env,
        consent: ConsentAccessManagerClient<'static>,
        provider_registry: ProviderRegistryClient<'static>,
        admin: Address,
        controller: Address,
        provider_operator: Address,
        passport_id: BytesN<32>,
        provider_id: BytesN<32>,
    }

    fn setup() -> Fixture {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let controller = Address::generate(&env);
        let provider_operator = Address::generate(&env);
        let passport_id = hash(&env, 1);
        let provider_id = hash(&env, 2);

        let patient_contract = env.register(PatientPassportRegistry, ());
        let patient_registry = PatientPassportRegistryClient::new(&env, &patient_contract);
        patient_registry.initialize(&admin);
        patient_registry.register_patient(&controller, &passport_id, &None, &hash(&env, 9));

        let provider_contract = env.register(ProviderRegistry, ());
        let provider_registry = ProviderRegistryClient::new(&env, &provider_contract);
        provider_registry.initialize(&admin);
        provider_registry.register_provider(
            &provider_operator,
            &provider_id,
            &ProviderType::Clinic,
            &hash(&env, 7),
            &symbol_short!("NG"),
            &hash(&env, 8),
        );
        provider_registry.verify_provider(&admin, &provider_id);

        let consent_contract = env.register(ConsentAccessManager, ());
        let consent = ConsentAccessManagerClient::new(&env, &consent_contract);
        consent.initialize(&admin, &patient_contract, &provider_contract);

        Fixture {
            env,
            consent,
            provider_registry,
            admin,
            controller,
            provider_operator,
            passport_id,
            provider_id,
        }
    }

    fn request(f: &Fixture, scope: RecordScope, duration: u64) -> u64 {
        f.consent.request_access(
            &f.provider_operator,
            &f.provider_id,
            &f.passport_id,
            &scope,
            &hash(&f.env, 3),
            &duration,
        )
    }

    #[test]
    fn requests_approves_and_checks_scoped_access() {
        let f = setup();
        let access_id = request(&f, RecordScope::LabResultsOnly, 86_400);

        let pending = f.consent.get_access(&access_id).unwrap();
        assert_eq!(pending.status, AccessStatus::Pending);
        assert!(!f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::LabResultsOnly
        ));

        f.consent.approve_access(&f.controller, &access_id, &3_600);

        let approved = f.consent.get_access(&access_id).unwrap();
        assert_eq!(approved.status, AccessStatus::Approved);
        assert_eq!(approved.expires_at, approved.decided_at + 3_600);
        assert!(f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::LabResultsOnly
        ));
        assert!(!f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::PrescriptionsOnly
        ));
        assert_eq!(f.consent.get_active_permissions(&f.passport_id).len(), 1);
    }

    #[test]
    fn all_records_scope_grants_every_category() {
        let f = setup();
        let access_id = request(&f, RecordScope::AllRecords, 86_400);
        f.consent.approve_access(&f.controller, &access_id, &86_400);

        assert!(f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::InsuranceDataOnly
        ));
    }

    #[test]
    fn rejects_non_owner_approval_and_excess_duration() {
        let f = setup();
        let access_id = request(&f, RecordScope::LabResultsOnly, 3_600);
        let stranger = Address::generate(&f.env);

        assert_eq!(
            f.consent.try_approve_access(&stranger, &access_id, &600),
            Err(Ok(Error::NotPassportController))
        );
        assert_eq!(
            f.consent
                .try_approve_access(&f.controller, &access_id, &7_200),
            Err(Ok(Error::DurationExceedsRequest))
        );
    }

    #[test]
    fn rejects_request_from_unverified_provider() {
        let f = setup();
        f.provider_registry
            .suspend_provider(&f.admin, &f.provider_id);

        assert_eq!(
            f.consent.try_request_access(
                &f.provider_operator,
                &f.provider_id,
                &f.passport_id,
                &RecordScope::LabResultsOnly,
                &hash(&f.env, 3),
                &3_600,
            ),
            Err(Ok(Error::ProviderNotVerified))
        );
    }

    #[test]
    fn revocation_and_registry_changes_invalidate_access() {
        let f = setup();
        let access_id = request(&f, RecordScope::LabResultsOnly, 86_400);
        f.consent.approve_access(&f.controller, &access_id, &86_400);
        assert!(f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::LabResultsOnly
        ));

        f.consent.revoke_access(&f.controller, &access_id);
        assert!(!f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::LabResultsOnly
        ));

        let access_id = request(&f, RecordScope::LabResultsOnly, 86_400);
        f.consent.approve_access(&f.controller, &access_id, &86_400);
        f.provider_registry
            .suspend_provider(&f.admin, &f.provider_id);
        assert!(!f.consent.check_access(
            &f.passport_id,
            &f.provider_id,
            &RecordScope::LabResultsOnly
        ));
    }

    #[test]
    fn expired_access_is_not_active() {
        let f = setup();
        f.env.ledger().set_timestamp(1_000);
        let access_id = request(&f, RecordScope::AllRecords, 60);
        f.consent.approve_access(&f.controller, &access_id, &60);
        assert!(f
            .consent
            .check_access(&f.passport_id, &f.provider_id, &RecordScope::AllRecords));

        f.env.ledger().set_timestamp(1_061);
        assert!(!f
            .consent
            .check_access(&f.passport_id, &f.provider_id, &RecordScope::AllRecords));
    }

    #[test]
    fn requires_initialization() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ConsentAccessManager, ());
        let client = ConsentAccessManagerClient::new(&env, &contract_id);

        assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    }
}
