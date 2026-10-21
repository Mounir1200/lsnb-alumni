begin;

-- This checks literal IP addresses only. DNS resolution and later redirects
-- are outside the validation contract; no remote requests are made here.
create function public.is_public_profile_ip(p_address inet)
returns boolean
language plpgsql
immutable
strict
security invoker
set search_path = ''
as $$
declare
  address_bytes bytea;
  embedded_offset integer;
  embedded_ipv4 inet;
begin
  if family(p_address) = 4 then
    return not (p_address <<= any (array[
      '0.0.0.0/8'::inet, '10.0.0.0/8'::inet, '100.64.0.0/10'::inet,
      '127.0.0.0/8'::inet, '169.254.0.0/16'::inet, '172.16.0.0/12'::inet,
      '192.168.0.0/16'::inet, '224.0.0.0/3'::inet
    ]));
  end if;

  if p_address <<= any (array[
    '::/96'::inet, 'fc00::/7'::inet, 'fe80::/10'::inet,
    'fec0::/10'::inet, 'ff00::/8'::inet,
    '64:ff9b:1::/48'::inet, '2001::/32'::inet
  ]) then
    return false;
  end if;

  if p_address <<= '::ffff:0:0/96'::inet
    or p_address <<= '::ffff:0:0:0/96'::inet
    or p_address <<= '64:ff9b::/96'::inet then
    embedded_offset := 16;
  elsif p_address <<= '2002::/16'::inet then
    embedded_offset := 6;
  else
    return true;
  end if;

  -- inet_send has a 4-byte header, then the address bytes in network order.
  address_bytes := inet_send(p_address);
  embedded_ipv4 := format('%s.%s.%s.%s',
    get_byte(address_bytes, embedded_offset), get_byte(address_bytes, embedded_offset + 1),
    get_byte(address_bytes, embedded_offset + 2), get_byte(address_bytes, embedded_offset + 3)
  )::inet;
  return public.is_public_profile_ip(embedded_ipv4);
end;
$$;

revoke all on function public.is_public_profile_ip(inet) from public, anon;
grant execute on function public.is_public_profile_ip(inet) to authenticated, service_role;

create or replace function public.is_valid_profile_link(p_url text, p_linkedin boolean)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $$
declare
  parts text[];
  authority text[];
  hostname text;
  port_number integer;
  ip_address inet;
begin
  if p_url is null then return true; end if;
  if char_length(p_url) > 2048 or p_url ~ '[[:space:][:cntrl:]\\]' then
    return false;
  end if;
  parts := regexp_match(p_url, '^https://([^/?#]+)(.*)$', 'i');
  if parts is null then return false; end if;
  -- ASCII/punycode DNS names or bracketed IP literals, no credentials or zones.
  authority := regexp_match(parts[1], '^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:([0-9]{1,5}))?$', 'i');
  if authority is null then return false; end if;
  hostname := lower(authority[1]);
  port_number := authority[3]::integer;
  if port_number > 65535 then return false; end if;

  if left(hostname, 1) = '[' then
    begin
      ip_address := substr(hostname, 2, char_length(hostname) - 2)::inet;
    exception when invalid_text_representation then
      return false;
    end;
    if family(ip_address) <> 6 or not public.is_public_profile_ip(ip_address) then return false; end if;
  else
    -- A single terminal dot denotes the DNS root; it must not bypass checks.
    hostname := regexp_replace(hostname, '\.$', '');
    if hostname ~ '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$' then
      -- Reject legacy octal, shortened, hexadecimal and integer IPv4 forms.
      if hostname !~ '^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$' then return false; end if;
      begin
        ip_address := hostname::inet;
      exception when invalid_text_representation then
        return false;
      end;
      if not public.is_public_profile_ip(ip_address) then return false; end if;
    else
      if char_length(hostname) > 253
        or hostname !~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$'
        or hostname ~ '(^|\.)([0-9]+|0x[0-9a-f]*)$'
        or hostname ~ '(^|\.)(localhost|localdomain|local|internal|lan|home|corp|home\.arpa)$' then
        return false;
      end if;
    end if;
  end if;

  if p_linkedin then
    return hostname ~ '^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)*linkedin\.com$'
      and (port_number is null or port_number = 443)
      and parts[2] ~ '^/in/[^/?#]+/?([?#].*)?$';
  end if;
  return true;
end;
$$;

-- Replacing an immutable function does not revalidate existing CHECK values.
-- Recreate both constraints in this transaction: any nonconforming stored link
-- aborts the migration without changing member data or partially applying it.
alter table public.profiles
  drop constraint profiles_linkedin_url_check,
  drop constraint profiles_portfolio_url_check,
  add constraint profiles_linkedin_url_check check (public.is_valid_profile_link(linkedin_url, true)),
  add constraint profiles_portfolio_url_check check (public.is_valid_profile_link(portfolio_url, false));

comment on column public.profiles.linkedin_url is
  'Optional HTTPS LinkedIn profile URL, visible to authenticated members with profile access.';
comment on column public.profiles.portfolio_url is
  'Optional HTTPS portfolio URL with a public hostname or IP literal, visible to authenticated members with profile access.';

notify pgrst, 'reload schema';

commit;
