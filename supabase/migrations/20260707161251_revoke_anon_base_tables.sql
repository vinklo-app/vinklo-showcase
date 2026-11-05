-- Defensa en profundidad: anon solo debe ver la vista pública, nunca las
-- tablas base (aunque RLS ya deniegue filas, retiramos el privilegio).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
grant select on public.weddings_public to anon;
