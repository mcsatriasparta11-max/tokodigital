-- Add a contact instruction to future unconfirmed PO reminders without changing timing.
begin;
do $$declare definition text;begin
 definition:=pg_get_functiondef('public.po_delivery_reminders(timestamp with time zone)'::regprocedure);
 if position('Jika ada kendala, informasikan kepada penerbit PO.' in definition)=0 then
  if position('belum Anda konfirmasi. Mohon konfirmasi PO dan isi estimasi pengantaran.' in definition)=0 then raise exception 'Unexpected confirmation reminder message';end if;
  execute replace(definition,'belum Anda konfirmasi. Mohon konfirmasi PO dan isi estimasi pengantaran.','belum Anda konfirmasi. Mohon konfirmasi PO dan isi estimasi pengantaran. Jika ada kendala, informasikan kepada penerbit PO.');
 end if;
end;$$;
notify pgrst, 'reload schema';
commit;
