begin;
create function public.po_valid_branch_qty(b jsonb,total integer) returns boolean language plpgsql immutable set search_path='' as $$
declare k text;v jsonb;n bigint:=0;
begin
 if b is null then return true;end if;
 if jsonb_typeof(b) is distinct from 'object' or (select count(*) from jsonb_object_keys(b))<>3 then return false;end if;
 foreach k in array array['MGR1','MGR2','LLG'] loop
 v:=b->k;if jsonb_typeof(v) is distinct from 'number' or v::text !~ '^[0-9]+$' then return false;end if;
 if v::numeric>10000000 then return false;end if;n:=n+v::bigint;
 end loop;return n=total and n between 1 and 10000000;
end;$$;
alter table public.po_items add column branch_qty jsonb;
alter table public.po_items add constraint po_item_branch_qty_valid check(public.po_valid_branch_qty(branch_qty,qty));
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_command(uuid,text,jsonb)'::regprocedure);
 if position('product_code,name,qty,unit,position)' in definition)=0 or position('(item->>''qty'')::integer,btrim(item->>''unit''),idx)' in definition)=0 then raise exception 'Unexpected item insertion';end if;
 definition:=replace(definition,'product_code,name,qty,unit,position)','product_code,name,qty,unit,position,branch_qty)');
 definition:=replace(definition,'(item->>''qty'')::integer,btrim(item->>''unit''),idx)','(item->>''qty'')::integer,btrim(item->>''unit''),idx,item->''branch_qty'')');
 execute definition;
 definition:=pg_get_functiondef('public.po_dashboard_items(uuid)'::regprocedure);
 if position('to_jsonb(i)-''qty''-''base_qty''' in definition)=0 then raise exception 'Unexpected qty masking';end if;
 execute replace(definition,'to_jsonb(i)-''qty''-''base_qty''','(to_jsonb(i)-''qty''-''base_qty''-''branch_qty'')||jsonb_build_object(''branch_mode'',i.branch_qty is not null)');
end;$$;
revoke all on function public.po_valid_branch_qty(jsonb,integer) from public,anon,authenticated;
grant execute on function public.po_valid_branch_qty(jsonb,integer) to authenticated;
notify pgrst,'reload schema';
commit;
