-- Local/dev seed users (plan §6-S3). Passwords are for LOCAL DEVELOPMENT ONLY.
-- admin@printforge.test / operator@printforge.test / customer1@... / customer2@...
-- all with password: printforge-dev-123

create extension if not exists pgcrypto;

do $$
declare
  seed_user record;
begin
  for seed_user in
    select * from (values
      ('a0000000-0000-4000-8000-000000000001'::uuid, 'admin@printforge.test',     'Asha Admin',    'admin'),
      ('a0000000-0000-4000-8000-000000000002'::uuid, 'operator@printforge.test',  'Omar Operator', 'operator'),
      ('a0000000-0000-4000-8000-000000000003'::uuid, 'customer1@printforge.test', 'Chitra One',    'customer'),
      ('a0000000-0000-4000-8000-000000000004'::uuid, 'customer2@printforge.test', 'Chetan Two',    'customer')
    ) as t(id, email, name, role)
  loop
    -- The GoTrue auth server scans several token columns as non-null strings;
    -- manually-seeded rows must set them to '' or sign-in fails with a 500.
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, recovery_token, email_change,
      email_change_token_new, email_change_token_current,
      phone_change, phone_change_token, reauthentication_token
    ) values (
      '00000000-0000-0000-0000-000000000000', seed_user.id, 'authenticated', 'authenticated',
      seed_user.email, crypt('printforge-dev-123', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', seed_user.name),
      now(), now(),
      '', '', '', '', '', '', '', ''
    ) on conflict (id) do nothing;

    insert into auth.identities (
      id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
    ) values (
      gen_random_uuid(), seed_user.id, seed_user.id::text,
      jsonb_build_object('sub', seed_user.id::text, 'email', seed_user.email, 'email_verified', true),
      'email', now(), now(), now()
    ) on conflict (provider_id, provider) do nothing;

    -- The on_auth_user_created trigger created the profile as 'customer';
    -- promote via the seed (server-side, mirroring service-role behavior).
    update public.profiles
      set role = seed_user.role::public.role_enum
      where user_id = seed_user.id;
  end loop;
end $$;
