/* Authenticated INSERT/UPDATE subscriptions. Row-level access still applies on the server. */
(function(root){
 root.createPORealtime=function({client,workspace,user,onChange,onStatus}){
  let channel,timer,stopped=false;
  const change=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!stopped)onChange()},200)};
  if(typeof client.channel!=='function')return {stop(){}};
  channel=client.channel('upu:'+workspace+':'+user)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'po_orders',filter:'workspace_id=eq.'+workspace},change)
   .on('postgres_changes',{event:'UPDATE',schema:'public',table:'po_orders',filter:'workspace_id=eq.'+workspace},change)
   .on('postgres_changes',{event:'INSERT',schema:'public',table:'po_notifications',filter:'user_id=eq.'+user},change)
   .subscribe(status=>{if(stopped)return;onStatus(status);if(status==='SUBSCRIBED')change()});
  return {stop(){stopped=true;clearTimeout(timer);client.removeChannel(channel)}};
 };
 if(typeof module!=='undefined')module.exports=root.createPORealtime;
})(globalThis);