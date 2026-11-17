#![no_std]

//! Verified healthcare provider registry.
//!
//! Provider documents and license numbers stay off-chain. The registry stores a
//! license commitment, provider category, jurisdiction, operator wallet, and
//! verification status.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
    Symbol,
};

const TTL_THRESHOLD: u32 = 2_592_000;
const TTL_BUMP: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderType {
    Hospital = 0,
    Clinic = 1,
    Doctor = 2,
    Laboratory = 3,
    Pharmacy = 4,
    InsuranceCompany = 5,
    PublicHealthAgency = 6,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ProviderStatus {
    Pending = 0,
    Verified = 1,
    Suspended = 2,
    Revoked = 3,
}

pub fn is_valid_transition(from: &ProviderStatus, to: &ProviderStatus) -> bool {
    matches!(
        (from, to),
        (ProviderStatus::Pending, ProviderStatus::Verified)
            | (ProviderStatus::Pending, ProviderStatus::Revoked)
            | (ProviderStatus::Verified, ProviderStatus::Suspended)
            | (ProviderStatus::Verified, ProviderStatus::Revoked)
            | (ProviderStatus::Suspended, ProviderStatus::Verified)
            | (ProviderStatus::Suspended, ProviderStatus::Revoked)
    )
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Provider {
    pub provider_id: BytesN<32>,
    pub operator: Address,
    pub provider_type: ProviderType,
    pub license_hash: BytesN<32>,
    pub jurisdiction: Symbol,
    pub metadata_hash: BytesN<32>,
    pub status: ProviderStatus,
    pub verified_by: Option<Address>,
    pub created_at: u64,
    pub updated_at: u64,
}

#[contractevent(topics = ["provider", "reg"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderRegistered {
    #[topic]
    pub provider_id: BytesN<32>,
    pub operator: Address,
}

#[contractevent(topics = ["provider", "status"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ProviderStatusChanged {
    #[topic]
    pub provider_id: BytesN<32>,
    pub status: ProviderStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Provider(BytesN<32>),
    OperatorProvider(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    ProviderExists = 4,
    OperatorAlreadyRegistered = 5,
    ProviderNotFound = 6,
    NotOperator = 7,
    InvalidStatusTransition = 8,
}

#[contract]
pub struct ProviderRegistry;

#[contractimpl]
impl ProviderRegistry {
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        bump_instance(&env);
        Ok(())
    }

    /// Registers a provider application. The provider starts in `Pending`
    /// status and cannot write records or request access until an admin
    /// verifies it.
    pub fn register_provider(
        env: Env,
        operator: Address,
        provider_id: BytesN<32>,
        provider_type: ProviderType,
        license_hash: BytesN<32>,
        jurisdiction: Symbol,
        metadata_hash: BytesN<32>,
    ) -> Result<(), Error> {
        operator.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Provider(provider_id.clone()))
        {
            return Err(Error::ProviderExists);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::OperatorProvider(operator.clone()))
        {
            return Err(Error::OperatorAlreadyRegistered);
        }

        let now = env.ledger().timestamp();
        let provider = Provider {
            provider_id: provider_id.clone(),
            operator: operator.clone(),
            provider_type,
            license_hash,
            jurisdiction,
            metadata_hash,
            status: ProviderStatus::Pending,
            verified_by: None,
            created_at: now,
            updated_at: now,
        };

        write_provider(&env, &provider);
        env.storage()
            .persistent()
            .set(&DataKey::OperatorProvider(operator.clone()), &provider_id);
        bump(&env, &DataKey::OperatorProvider(operator.clone()));

        ProviderRegistered {
            provider_id,
            operator,
        }
        .publish(&env);
        Ok(())
    }

    pub fn verify_provider(env: Env, admin: Address, provider_id: BytesN<32>) -> Result<(), Error> {
        transition(&env, &admin, &provider_id, ProviderStatus::Verified)
    }

    pub fn suspend_provider(
        env: Env,
        admin: Address,
        provider_id: BytesN<32>,
    ) -> Result<(), Error> {
        transition(&env, &admin, &provider_id, ProviderStatus::Suspended)
    }

    pub fn reinstate_provider(
        env: Env,
        admin: Address,
        provider_id: BytesN<32>,
    ) -> Result<(), Error> {
        transition(&env, &admin, &provider_id, ProviderStatus::Verified)
    }

    pub fn revoke_provider(env: Env, admin: Address, provider_id: BytesN<32>) -> Result<(), Error> {
        transition(&env, &admin, &provider_id, ProviderStatus::Revoked)
    }

    pub fn transfer_admin(env: Env, admin: Address, new_admin: Address) -> Result<(), Error> {
        require_admin(&env, &admin)?;
        new_admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        bump_instance(&env);
        Ok(())
    }

    pub fn get_admin(env: Env) -> Result<Address, Error> {
        read_admin(&env)
    }

    pub fn get_provider(env: Env, provider_id: BytesN<32>) -> Option<Provider> {
        let key = DataKey::Provider(provider_id);
        let provider = env.storage().persistent().get(&key);
        if provider.is_some() {
            bump(&env, &key);
        }
        provider
    }

    pub fn get_provider_by_operator(env: Env, operator: Address) -> Option<Provider> {
        let key = DataKey::OperatorProvider(operator);
        let provider_id = env.storage().persistent().get::<DataKey, BytesN<32>>(&key);
        match provider_id {
            Some(provider_id) => {
                bump(&env, &key);
                env.storage()
                    .persistent()
                    .get(&DataKey::Provider(provider_id))
            }
            None => None,
        }
    }

    pub fn get_provider_operator(env: Env, provider_id: BytesN<32>) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Provider>(&DataKey::Provider(provider_id))
            .map(|provider| provider.operator)
    }

    pub fn is_provider_verified(env: Env, provider_id: BytesN<32>) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Provider>(&DataKey::Provider(provider_id))
        {
            Some(provider) => provider.status == ProviderStatus::Verified,
            None => false,
        }
    }

    pub fn is_provider_operator(env: Env, provider_id: BytesN<32>, operator: Address) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Provider>(&DataKey::Provider(provider_id))
        {
            Some(provider) => provider.operator == operator,
            None => false,
        }
    }
}

fn transition(
    env: &Env,
    admin: &Address,
    provider_id: &BytesN<32>,
    status: ProviderStatus,
) -> Result<(), Error> {
    require_admin(env, admin)?;

    let mut provider = read_provider(env, provider_id)?;
    if !is_valid_transition(&provider.status, &status) {
        return Err(Error::InvalidStatusTransition);
    }

    provider.status = status;
    if status == ProviderStatus::Verified {
        provider.verified_by = Some(admin.clone());
    }
    provider.updated_at = env.ledger().timestamp();
    write_provider(env, &provider);

    ProviderStatusChanged {
        provider_id: provider_id.clone(),
        status,
    }
    .publish(env);
    Ok(())
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

fn read_provider(env: &Env, provider_id: &BytesN<32>) -> Result<Provider, Error> {
    let key = DataKey::Provider(provider_id.clone());
    let provider = env
        .storage()
        .persistent()
        .get::<DataKey, Provider>(&key)
        .ok_or(Error::ProviderNotFound)?;
    bump(env, &key);
    Ok(provider)
}

fn write_provider(env: &Env, provider: &Provider) {
    let key = DataKey::Provider(provider.provider_id.clone());
    env.storage().persistent().set(&key, provider);
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
    use soroban_sdk::{symbol_short, testutils::Address as _, Address, BytesN, Env, Symbol};

    fn hash(env: &Env, value: u8) -> BytesN<32> {
        BytesN::from_array(env, &[value; 32])
    }

    fn setup() -> (
        Env,
        ProviderRegistryClient<'static>,
        Address,
        Address,
        BytesN<32>,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ProviderRegistry, ());
        let client = ProviderRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let operator = Address::generate(&env);
        let provider_id = hash(&env, 1);
        client.initialize(&admin);
        (env, client, admin, operator, provider_id)
    }

    #[test]
    fn registers_and_verifies_provider() {
        let (env, client, admin, operator, provider_id) = setup();
        let jurisdiction: Symbol = symbol_short!("NG");

        client.register_provider(
            &operator,
            &provider_id,
            &ProviderType::Laboratory,
            &hash(&env, 7),
            &jurisdiction,
            &hash(&env, 8),
        );

        let provider = client.get_provider(&provider_id).unwrap();
        assert_eq!(provider.status, ProviderStatus::Pending);
        assert_eq!(provider.operator, operator);
        assert!(!client.is_provider_verified(&provider_id));

        client.verify_provider(&admin, &provider_id);
        assert!(client.is_provider_verified(&provider_id));
        assert!(client.is_provider_operator(&provider_id, &operator));
        assert_eq!(
            client
                .get_provider_by_operator(&operator)
                .unwrap()
                .provider_id,
            provider_id
        );
    }

    #[test]
    fn enforces_provider_lifecycle() {
        let (env, client, admin, operator, provider_id) = setup();
        client.register_provider(
            &operator,
            &provider_id,
            &ProviderType::Clinic,
            &hash(&env, 7),
            &symbol_short!("NG"),
            &hash(&env, 8),
        );

        client.verify_provider(&admin, &provider_id);
        client.suspend_provider(&admin, &provider_id);
        assert!(!client.is_provider_verified(&provider_id));

        client.reinstate_provider(&admin, &provider_id);
        assert!(client.is_provider_verified(&provider_id));

        client.revoke_provider(&admin, &provider_id);
        assert!(!client.is_provider_verified(&provider_id));
        assert_eq!(
            client.try_reinstate_provider(&admin, &provider_id),
            Err(Ok(Error::InvalidStatusTransition))
        );
    }

    #[test]
    fn rejects_duplicate_provider_or_operator() {
        let (env, client, _, operator, provider_id) = setup();
        client.register_provider(
            &operator,
            &provider_id,
            &ProviderType::Doctor,
            &hash(&env, 7),
            &symbol_short!("NG"),
            &hash(&env, 8),
        );

        assert_eq!(
            client.try_register_provider(
                &Address::generate(&env),
                &provider_id,
                &ProviderType::Doctor,
                &hash(&env, 7),
                &symbol_short!("NG"),
                &hash(&env, 8)
            ),
            Err(Ok(Error::ProviderExists))
        );
        assert_eq!(
            client.try_register_provider(
                &operator,
                &hash(&env, 2),
                &ProviderType::Doctor,
                &hash(&env, 7),
                &symbol_short!("NG"),
                &hash(&env, 8)
            ),
            Err(Ok(Error::OperatorAlreadyRegistered))
        );
    }

    #[test]
    fn requires_initialization() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(ProviderRegistry, ());
        let client = ProviderRegistryClient::new(&env, &contract_id);

        assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    }
}
