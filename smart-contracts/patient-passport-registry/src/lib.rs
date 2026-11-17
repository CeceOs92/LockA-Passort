#![no_std]

//! Patient passport identity registry.
//!
//! Stores a stable `passport_id`, the current controller wallet, an optional
//! recovery wallet, and the passport lifecycle status. It never stores medical
//! data or personal identity documents.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, BytesN, Env,
};

const TTL_THRESHOLD: u32 = 2_592_000;
const TTL_BUMP: u32 = 5_184_000;

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PassportStatus {
    Active = 0,
    Suspended = 1,
    Revoked = 2,
}

pub fn is_valid_transition(from: &PassportStatus, to: &PassportStatus) -> bool {
    matches!(
        (from, to),
        (PassportStatus::Active, PassportStatus::Suspended)
            | (PassportStatus::Suspended, PassportStatus::Active)
            | (PassportStatus::Active, PassportStatus::Revoked)
            | (PassportStatus::Suspended, PassportStatus::Revoked)
    )
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Passport {
    pub passport_id: BytesN<32>,
    pub controller: Address,
    pub recovery: Option<Address>,
    pub identity_commitment: BytesN<32>,
    pub created_at: u64,
    pub updated_at: u64,
    pub status: PassportStatus,
}

#[contractevent(topics = ["patient", "reg"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PatientRegistered {
    #[topic]
    pub passport_id: BytesN<32>,
    pub controller: Address,
}

#[contractevent(topics = ["patient", "rotate"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControllerRotated {
    #[topic]
    pub passport_id: BytesN<32>,
    pub new_controller: Address,
}

#[contractevent(topics = ["patient", "recover"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ControllerRecovered {
    #[topic]
    pub passport_id: BytesN<32>,
    pub new_controller: Address,
}

#[contractevent(topics = ["patient", "status"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PassportStatusChanged {
    #[topic]
    pub passport_id: BytesN<32>,
    pub status: PassportStatus,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Passport(BytesN<32>),
    ControllerPassport(Address),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    PassportExists = 4,
    ControllerAlreadyRegistered = 5,
    PassportNotFound = 6,
    NotController = 7,
    NotRecovery = 8,
    RecoveryNotSet = 9,
    InvalidStatusTransition = 10,
}

#[contract]
pub struct PatientPassportRegistry;

#[contractimpl]
impl PatientPassportRegistry {
    /// Initializes the registry with the address allowed to suspend or revoke
    /// passports and transfer administration.
    pub fn initialize(env: Env, admin: Address) -> Result<(), Error> {
        admin.require_auth();
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        bump_instance(&env);
        Ok(())
    }

    /// Registers a new patient-controlled passport.
    ///
    /// The controller signs the registration. `passport_id` is the stable
    /// business identifier used by the other LockA contracts. `identity_commitment`
    /// must be a hash/commitment, never a raw identity document.
    pub fn register_patient(
        env: Env,
        controller: Address,
        passport_id: BytesN<32>,
        recovery: Option<Address>,
        identity_commitment: BytesN<32>,
    ) -> Result<(), Error> {
        controller.require_auth();

        if env
            .storage()
            .persistent()
            .has(&DataKey::Passport(passport_id.clone()))
        {
            return Err(Error::PassportExists);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::ControllerPassport(controller.clone()))
        {
            return Err(Error::ControllerAlreadyRegistered);
        }

        let now = env.ledger().timestamp();
        let passport = Passport {
            passport_id: passport_id.clone(),
            controller: controller.clone(),
            recovery,
            identity_commitment,
            created_at: now,
            updated_at: now,
            status: PassportStatus::Active,
        };

        write_passport(&env, &passport);
        env.storage().persistent().set(
            &DataKey::ControllerPassport(controller.clone()),
            &passport_id,
        );
        bump(&env, &DataKey::ControllerPassport(controller.clone()));

        PatientRegistered {
            passport_id,
            controller,
        }
        .publish(&env);
        Ok(())
    }

    /// Rotates the controller wallet using the current controller's authorization.
    pub fn rotate_controller(
        env: Env,
        controller: Address,
        passport_id: BytesN<32>,
        new_controller: Address,
    ) -> Result<(), Error> {
        controller.require_auth();

        let mut passport = read_passport(&env, &passport_id)?;
        if passport.controller != controller {
            return Err(Error::NotController);
        }
        ensure_controller_available(&env, &new_controller)?;

        env.storage()
            .persistent()
            .remove(&DataKey::ControllerPassport(controller));
        env.storage().persistent().set(
            &DataKey::ControllerPassport(new_controller.clone()),
            &passport_id,
        );
        bump(&env, &DataKey::ControllerPassport(new_controller.clone()));

        passport.controller = new_controller.clone();
        passport.updated_at = env.ledger().timestamp();
        write_passport(&env, &passport);

        ControllerRotated {
            passport_id,
            new_controller,
        }
        .publish(&env);
        Ok(())
    }

    /// Recovers a passport using the configured recovery address.
    pub fn recover_controller(
        env: Env,
        recovery: Address,
        passport_id: BytesN<32>,
        new_controller: Address,
    ) -> Result<(), Error> {
        recovery.require_auth();

        let mut passport = read_passport(&env, &passport_id)?;
        let configured_recovery = passport.recovery.clone().ok_or(Error::RecoveryNotSet)?;
        if configured_recovery != recovery {
            return Err(Error::NotRecovery);
        }
        ensure_controller_available(&env, &new_controller)?;

        env.storage()
            .persistent()
            .remove(&DataKey::ControllerPassport(passport.controller.clone()));
        env.storage().persistent().set(
            &DataKey::ControllerPassport(new_controller.clone()),
            &passport_id,
        );
        bump(&env, &DataKey::ControllerPassport(new_controller.clone()));

        passport.controller = new_controller.clone();
        passport.updated_at = env.ledger().timestamp();
        write_passport(&env, &passport);

        ControllerRecovered {
            passport_id,
            new_controller,
        }
        .publish(&env);
        Ok(())
    }

    /// Suspends, reinstates, or revokes a passport. Admin only.
    pub fn set_status(
        env: Env,
        admin: Address,
        passport_id: BytesN<32>,
        status: PassportStatus,
    ) -> Result<(), Error> {
        require_admin(&env, &admin)?;

        let mut passport = read_passport(&env, &passport_id)?;
        if !is_valid_transition(&passport.status, &status) {
            return Err(Error::InvalidStatusTransition);
        }

        passport.status = status;
        passport.updated_at = env.ledger().timestamp();
        write_passport(&env, &passport);

        PassportStatusChanged {
            passport_id,
            status,
        }
        .publish(&env);
        Ok(())
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

    pub fn get_passport(env: Env, passport_id: BytesN<32>) -> Option<Passport> {
        let key = DataKey::Passport(passport_id);
        let passport = env.storage().persistent().get(&key);
        if passport.is_some() {
            bump(&env, &key);
        }
        passport
    }

    pub fn get_passport_by_controller(env: Env, controller: Address) -> Option<Passport> {
        let key = DataKey::ControllerPassport(controller);
        let passport_id = env.storage().persistent().get::<DataKey, BytesN<32>>(&key);
        match passport_id {
            Some(passport_id) => {
                bump(&env, &key);
                env.storage()
                    .persistent()
                    .get(&DataKey::Passport(passport_id))
            }
            None => None,
        }
    }

    pub fn get_passport_controller(env: Env, passport_id: BytesN<32>) -> Option<Address> {
        env.storage()
            .persistent()
            .get::<DataKey, Passport>(&DataKey::Passport(passport_id))
            .map(|passport| passport.controller)
    }

    pub fn is_passport_controller(env: Env, passport_id: BytesN<32>, controller: Address) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Passport>(&DataKey::Passport(passport_id))
        {
            Some(passport) => passport.controller == controller,
            None => false,
        }
    }

    pub fn is_passport_active(env: Env, passport_id: BytesN<32>) -> bool {
        match env
            .storage()
            .persistent()
            .get::<DataKey, Passport>(&DataKey::Passport(passport_id))
        {
            Some(passport) => passport.status == PassportStatus::Active,
            None => false,
        }
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
    let stored = read_admin(env)?;
    if stored != *admin {
        return Err(Error::NotAdmin);
    }
    Ok(())
}

fn read_passport(env: &Env, passport_id: &BytesN<32>) -> Result<Passport, Error> {
    let key = DataKey::Passport(passport_id.clone());
    let passport = env
        .storage()
        .persistent()
        .get::<DataKey, Passport>(&key)
        .ok_or(Error::PassportNotFound)?;
    bump(env, &key);
    Ok(passport)
}

fn write_passport(env: &Env, passport: &Passport) {
    let key = DataKey::Passport(passport.passport_id.clone());
    env.storage().persistent().set(&key, passport);
    bump(env, &key);
}

fn ensure_controller_available(env: &Env, controller: &Address) -> Result<(), Error> {
    if env
        .storage()
        .persistent()
        .has(&DataKey::ControllerPassport(controller.clone()))
    {
        return Err(Error::ControllerAlreadyRegistered);
    }
    Ok(())
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
    use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

    fn commitment(env: &Env, value: u8) -> BytesN<32> {
        BytesN::from_array(env, &[value; 32])
    }

    fn setup() -> (
        Env,
        PatientPassportRegistryClient<'static>,
        Address,
        Address,
        BytesN<32>,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PatientPassportRegistry, ());
        let client = PatientPassportRegistryClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        let controller = Address::generate(&env);
        let passport_id = commitment(&env, 1);
        client.initialize(&admin);
        (env, client, admin, controller, passport_id)
    }

    #[test]
    fn registers_and_reads_a_passport() {
        let (env, client, _, controller, passport_id) = setup();
        let recovery = Address::generate(&env);

        client.register_patient(
            &controller,
            &passport_id,
            &Some(recovery.clone()),
            &commitment(&env, 9),
        );

        let passport = client.get_passport(&passport_id).unwrap();
        assert_eq!(passport.controller, controller);
        assert_eq!(passport.recovery, Some(recovery));
        assert_eq!(passport.status, PassportStatus::Active);
        assert!(client.is_passport_active(&passport_id));
        assert!(client.is_passport_controller(&passport_id, &controller));
        assert_eq!(
            client.get_passport_controller(&passport_id),
            Some(controller.clone())
        );
        assert_eq!(
            client
                .get_passport_by_controller(&controller)
                .unwrap()
                .passport_id,
            passport_id
        );
    }

    #[test]
    fn rejects_duplicate_passport_and_controller() {
        let (env, client, _, controller, passport_id) = setup();
        client.register_patient(&controller, &passport_id, &None, &commitment(&env, 9));

        assert_eq!(
            client.try_register_patient(
                &Address::generate(&env),
                &passport_id,
                &None,
                &commitment(&env, 8)
            ),
            Err(Ok(Error::PassportExists))
        );
        assert_eq!(
            client.try_register_patient(
                &controller,
                &commitment(&env, 2),
                &None,
                &commitment(&env, 8)
            ),
            Err(Ok(Error::ControllerAlreadyRegistered))
        );
    }

    #[test]
    fn rotates_and_recovers_controller() {
        let (env, client, _, controller, passport_id) = setup();
        let recovery = Address::generate(&env);
        let new_controller = Address::generate(&env);
        let recovered_controller = Address::generate(&env);

        client.register_patient(
            &controller,
            &passport_id,
            &Some(recovery.clone()),
            &commitment(&env, 9),
        );
        client.rotate_controller(&controller, &passport_id, &new_controller);
        assert!(client.get_passport_by_controller(&controller).is_none());
        assert_eq!(
            client.get_passport_controller(&passport_id),
            Some(new_controller)
        );

        client.recover_controller(&recovery, &passport_id, &recovered_controller);
        assert_eq!(
            client.get_passport_controller(&passport_id),
            Some(recovered_controller)
        );
    }

    #[test]
    fn enforces_status_transitions() {
        let (env, client, admin, controller, passport_id) = setup();
        client.register_patient(&controller, &passport_id, &None, &commitment(&env, 9));

        client.set_status(&admin, &passport_id, &PassportStatus::Suspended);
        assert!(!client.is_passport_active(&passport_id));

        client.set_status(&admin, &passport_id, &PassportStatus::Active);
        assert!(client.is_passport_active(&passport_id));

        client.set_status(&admin, &passport_id, &PassportStatus::Revoked);
        assert_eq!(
            client.try_set_status(&admin, &passport_id, &PassportStatus::Active),
            Err(Ok(Error::InvalidStatusTransition))
        );
    }

    #[test]
    fn requires_initialization() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PatientPassportRegistry, ());
        let client = PatientPassportRegistryClient::new(&env, &contract_id);

        assert_eq!(client.try_get_admin(), Err(Ok(Error::NotInitialized)));
    }
}
