-- 1) Crie o usuário pelo painel Supabase > Authentication > Users.
-- 2) Substitua o e-mail abaixo pelo e-mail real de seu administrador.
-- 3) Execute no SQL Editor (NUNCA no frontend).
update public.nf_profiles set role='admin'
where user_id=(select id from auth.users where lower(email)=lower('SEU_EMAIL_AQUI@EXEMPLO.COM'));
-- Confira:
select email,role from public.nf_profiles order by email;
