#![no_std]
#![allow(clippy::too_many_arguments)]

//! Tamper-evident registry for encrypted medical-record references.
//!
//! The contract stores fixed-size hashes and provenance metadata. Encrypted
//! files and storage URLs remain off-chain. A record can only be anchored by
//! the operator of a currently verified provider, and only for an active
//! passport.

use soroban_sdk::{
    contract, contractclient, contracterror, contractevent, contractimpl, contracttype, Address,
    BytesN, Env, Vec,
};

const TTL_THRESHOLD: u32 = 2_592_000;
const TTL_BUMP: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordType {
    LabResult = 0,
    Prescription = 1,
    Diagnosis = 2,
    Vaccination = 3,
    SurgeryReport = 4,
    AllergyRecord = 5,
    InsuranceRecord = 6,
    MedicalSummary = 7,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum RecordStatus {
    Active = 0,
    Amended = 1,
    Revoked = 2,
}

pub fn is_valid_transition(from: &RecordStatus, to: &RecordStatus) -> bool {
    matches!(
        (from, to),
        (RecordStatus::Active, RecordStatus::Amended)
            | (RecordStatus::Active, RecordStatus::Revoked)
            | (RecordStatus::Amended, RecordStatus::Revoked)
    )
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordMetadata {
    pub record_id: BytesN<32>,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
    pub record_type: RecordType,
    pub encrypted_file_hash: BytesN<32>,
    pub storage_pointer_hash: BytesN<32>,
    pub issued_at: u64,
    pub updated_at: u64,
    pub status: RecordStatus,
}

#[contractevent(topics = ["record", "added"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordAdded {
    #[topic]
    pub record_id: BytesN<32>,
    pub passport_id: BytesN<32>,
    pub provider_id: BytesN<32>,
}

#[contractevent(topics = ["record", "status"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecordStatusChanged {
    #[topic]
    pub record_id: BytesN<32>,
    pub status: RecordStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    PassportRegistry,
    ProviderRegistry,
    Record(BytesN<32>),
    PatientRecords(BytesN<32>),
    ProviderRecords(BytesN<32>),
}

#[contractclient(name = "PassportRegistryViewClient")]
pub trait PassportRegistryView {
    fn is_passport_active(env: Env, passport_id: BytesN<32>) -> bool;
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
    ProviderNotVerified = 4,
    ProviderOperatorMismatch = 5,
    PassportNotActive = 6,
    RecordExists = 7,
    RecordNotFound = 8,
    NotRecordProvider = 9,
    InvalidStatusTransition = 10,
}

#[contract]
pub struct MedicalRecordRegistry;

#[contractimpl]
impl MedicalRecordRegistry {
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

    /// Anchors an encrypted-record reference.
    pub fn add_record(
        env: Env,
        provider_operator: Address,
        provider_id: BytesN<32>,
        passport_id: BytesN<32>,
        record_id: BytesN<32>,
        record_type: RecordType,
        encrypted_file_hash: BytesN<32>,
        storage_pointer_hash: BytesN<32>,
    ) -> Result<(), Error> {
        provider_operator.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Record(record_id.clone()))
        {
            return Err(Error::RecordExists);
        }

        require_active_provider(&env, &provider_id, &provider_operator)?;
        require_active_passport(&env, &passport_id)?;

        let now = env.ledger().timestamp();
        let record = RecordMetadata {
            record_id: record_id.clone(),
            passport_id: passport_id.clone(),
            provider_id: provider_id.clone(),
            record_type,
            encrypted_file_hash,
            storage_pointer_hash,
            issued_at: now,
            updated_at: now,
            status: RecordStatus::Active,
        };

        write_record(&env, &record);
        append_index(
            &env,
            DataKey::PatientRecords(passport_id.clone()),
            record_id.clone(),
        );
        append_index(
            &env,
            DataKey::ProviderRecords(provider_id.clone()),
            record_id.clone(),
        );

        RecordAdded {
            record_id,
            passport_id,
            provider_id,
        }
        .publish(&env);
        Ok(())
    }

    /// Amends or revokes a record. Only the issuing provider can change it.
    pub fn update_record_status(
        env: Env,
        provider_operator: Address,
        record_id: BytesN<32>,
        status: RecordStatus,
    ) -> Result<(), Error> {
        provider_operator.require_auth();

        let mut record = read_record(&env, &record_id)?;
        if !is_valid_transition(&record.status, &status) {
            return Err(Error::InvalidStatusTransition);
        }
        if !is_operator(&env, &record.provider_id, &provider_operator) {
            return Err(Error::ProviderOperatorMismatch);
        }
        if !is_verified_provider(&env, &record.provider_id) {
            return Err(Error::ProviderNotVerified);
        }

        record.status = status;
        record.updated_at = env.ledger().timestamp();
        write_record(&env, &record);

        RecordStatusChanged { record_id, status }.publish(&env);
        Ok(())
    }

    pub fn verify_record_hash(
        env: Env,
        record_id: BytesN<32>,
        encrypted_file_hash: BytesN<32>,
    ) -> bool {
        match read_record_optional(&env, &record_id) {
            Some(record) => record.encrypted_file_hash == encrypted_file_hash,
            None => false,
        }
    }

    pub fn get_record(env: Env, record_id: BytesN<32>) -> Option<RecordMetadata> {
        read_record_optional(&env, &record_id)
    }

    pub fn get_patient_record_ids(env: Env, passport_id: BytesN<32>) -> Vec<BytesN<32>> {
        read_index(&env, DataKey::PatientRecords(passport_id))
    }

    pub fn get_provider_record_ids(env: Env, provider_id: BytesN<32>) -> Vec<BytesN<32>> {
        read_index(&env, DataKey::ProviderRecords(provider_id))
    }

    pub fn get_provider_records(env: Env, provider_id: BytesN<32>) -> Vec<RecordMetadata> {
        let mut records = Vec::new(&env);
        for record_id in read_index(&env, DataKey::ProviderRecords(provider_id)) {
            if let Some(record) = read_record_optional(&env, &record_id) {
                records.push_back(record);
            }
        }
        records
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

fn provider_client(env: &Env) -> Result<ProviderRegistryViewClient<'_>, Error> {
    let (_, provider_registry) = read_registries(env)?;
    Ok(ProviderRegistryViewClient::new(env, &provider_registry))
}

fn passport_client(env: &Env) -> Result<PassportRegistryViewClient<'_>, Error> {
    let (passport_registry, _) = read_registries(env)?;
    Ok(PassportRegistryViewClient::new(env, &passport_registry))
}

fn is_verified_provider(env: &Env, provider_id: &BytesN<32>) -> bool {
    match provider_client(env) {
        Ok(client) => client.is_provider_verified(provider_id),
        Err(_) => false,
    }
}

fn is_operator(env: &Env, provider_id: &BytesN<32>, operator: &Address) -> bool {
    match provider_client(env) {
        Ok(client) => client.is_provider_operator(provider_id, operator),
        Err(_) => false,
    }
}

fn require_active_provider(
    env: &Env,
    provider_id: &BytesN<32>,
    operator: &Address,
) -> Result<(), Error> {
    let client = provider_client(env)?;
    if !client.is_provider_verified(provider_id) {
        return Err(Error::ProviderNotVerified);
    }
    if !client.is_provider_operator(provider_id, operator) {
        return Err(Error::ProviderOperatorMismatch);
    }
    Ok(())
}

fn require_active_passport(env: &Env, passport_id: &BytesN<32>) -> Result<(), Error> {
    let client = passport_client(env)?;
    if !client.is_passport_active(passport_id) {
        return Err(Error::PassportNotActive);
    }
    Ok(())
}

fn read_record(env: &Env, record_id: &BytesN<32>) -> Result<RecordMetadata, Error> {
    read_record_optional(env, record_id).ok_or(Error::RecordNotFound)
}

fn read_record_optional(env: &Env, record_id: &BytesN<32>) -> Option<RecordMetadata> {
    let key = DataKey::Record(record_id.clone());
    let record = env.storage().persistent().get(&key);
    if record.is_some() {
        bump(env, &key);
    }
    record
}

fn write_record(env: &Env, record: &RecordMetadata) {
    let key = DataKey::Record(record.record_id.clone());
    env.storage().persistent().set(&key, record);
    bump(env, &key);
}

fn read_index(env: &Env, key: DataKey) -> Vec<BytesN<32>> {
    let ids = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<BytesN<32>>>(&key)
        .unwrap_or(Vec::new(env));
    if !ids.is_empty() {
        bump(env, &key);
    }
    ids
}

fn append_index(env: &Env, key: DataKey, record_id: BytesN<32>) {
    let mut ids = env
        .storage()
        .persistent()
        .get::<DataKey, Vec<BytesN<32>>>(&key)
        .unwrap_or(Vec::new(env));
    ids.push_back(record_id);
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
    use soroban_sdk::{symbol_short, testutils::Address as _, Address, BytesN, Env};

    fn hash(env: &Env, value: u8) -> BytesN<32> {
        BytesN::from_array(env, &[value; 32])
    }

    struct Fixture {
        env: Env,
        records: MedicalRecordRegistryClient<'static>,
        patient_registry: PatientPassportRegistryClient<'static>,
        provider_registry: ProviderRegistryClient<'static>,
        admin: Address,
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
            &ProviderType::Laboratory,
            &hash(&env, 7),
            &symbol_short!("NG"),
            &hash(&env, 8),
        );
        provider_registry.verify_provider(&admin, &provider_id);

        let records_contract = env.register(MedicalRecordRegistry, ());
        let records = MedicalRecordRegistryClient::new(&env, &records_contract);
        records.initialize(&admin, &patient_contract, &provider_contract);

        Fixture {
            env,
            records,
            patient_registry,
            provider_registry,
            admin,
            provider_operator,
            passport_id,
            provider_id,
        }
    }

    fn add(f: &Fixture, record_id: BytesN<32>, encrypted_hash: BytesN<32>) {
        f.records.add_record(
            &f.provider_operator,
            &f.provider_id,
            &f.passport_id,
            &record_id,
            &RecordType::LabResult,
            &encrypted_hash,
            &hash(&f.env, 6),
        );
    }

    #[test]
    fn anchors_verifies_indexes_and_updates_record() {
        let f = setup();
        let record_id = hash(&f.env, 3);
        let encrypted_hash = hash(&f.env, 4);

        add(&f, record_id.clone(), encrypted_hash.clone());

        let record = f.records.get_record(&record_id).unwrap();
        assert_eq!(record.provider_id, f.provider_id);
        assert_eq!(record.passport_id, f.passport_id);
        assert_eq!(record.status, RecordStatus::Active);
        assert!(f.records.verify_record_hash(&record_id, &encrypted_hash));
        assert!(!f.records.verify_record_hash(&record_id, &hash(&f.env, 5)));
        assert_eq!(
            f.records.get_patient_record_ids(&f.passport_id),
            soroban_sdk::vec![&f.env, record_id.clone()]
        );
        assert_eq!(
            f.records.get_provider_record_ids(&f.provider_id),
            soroban_sdk::vec![&f.env, record_id.clone()]
        );

        f.records
            .update_record_status(&f.provider_operator, &record_id, &RecordStatus::Amended);
        assert_eq!(
            f.records.get_record(&record_id).unwrap().status,
            RecordStatus::Amended
        );
    }

    #[test]
    fn rejects_unverified_provider_and_wrong_operator() {
        let f = setup();
        let record_id = hash(&f.env, 3);
        f.provider_registry
            .suspend_provider(&f.admin, &f.provider_id);

        assert_eq!(
            f.records.try_add_record(
                &f.provider_operator,
                &f.provider_id,
                &f.passport_id,
                &record_id,
                &RecordType::LabResult,
                &hash(&f.env, 4),
                &hash(&f.env, 6),
            ),
            Err(Ok(Error::ProviderNotVerified))
        );

        f.provider_registry
            .reinstate_provider(&f.admin, &f.provider_id);
        assert_eq!(
            f.records.try_add_record(
                &Address::generate(&f.env),
                &f.provider_id,
                &f.passport_id,
                &record_id,
                &RecordType::LabResult,
                &hash(&f.env, 4),
                &hash(&f.env, 6),
            ),
            Err(Ok(Error::ProviderOperatorMismatch))
        );
    }

    #[test]
    fn rejects_inactive_passport_and_duplicate_record() {
        let f = setup();
        let record_id = hash(&f.env, 3);
        add(&f, record_id.clone(), hash(&f.env, 4));

        assert_eq!(
            f.records.try_add_record(
                &f.provider_operator,
                &f.provider_id,
                &f.passport_id,
                &record_id,
                &RecordType::LabResult,
                &hash(&f.env, 4),
                &hash(&f.env, 6),
            ),
            Err(Ok(Error::RecordExists))
        );

        f.patient_registry.set_status(
            &f.admin,
            &f.passport_id,
            &patient_passport_registry::PassportStatus::Suspended,
        );
        assert_eq!(
            f.records.try_add_record(
                &f.provider_operator,
                &f.provider_id,
                &f.passport_id,
                &hash(&f.env, 9),
                &RecordType::LabResult,
                &hash(&f.env, 4),
                &hash(&f.env, 6),
            ),
            Err(Ok(Error::PassportNotActive))
        );
    }

    #[test]
    fn enforces_record_status_transitions() {
        let f = setup();
        let record_id = hash(&f.env, 3);
        add(&f, record_id.clone(), hash(&f.env, 4));

        f.records
            .update_record_status(&f.provider_operator, &record_id, &RecordStatus::Revoked);
        assert_eq!(
            f.records.try_update_record_status(
                &f.provider_operator,
                &record_id,
                &RecordStatus::Active,
            ),
            Err(Ok(Error::InvalidStatusTransition))
        );
    }

    #[test]
    fn requires_initialization() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(MedicalRecordRegistry, ());
        let client = MedicalRecordRegistryClient::new(&env, &contract_id);

        assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    }
}
