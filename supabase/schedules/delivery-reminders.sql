-- Hosted activation. The worker checks Jakarta time and prevents daily duplicates.
do $$declare job record;begin
 for job in select jobid from cron.job where jobname='upu-delivery-reminders' loop perform cron.unschedule(job.jobid);end loop;
 perform cron.schedule('upu-delivery-reminders','0 * * * *','select public.po_delivery_reminders();');
end;$$;
select public.po_delivery_reminders() as reminders_created;
