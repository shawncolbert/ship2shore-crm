-- calculate_suggested_price() is trigger-only (dereferences NEW/OLD) and
-- must never be callable as a direct RPC. preview_suggested_price() is the
-- only pricing function meant to be called from the frontend.

revoke all on function public.calculate_suggested_price() from public, anon, authenticated;

revoke all on function public.preview_suggested_price(uuid, text, numeric, text, text, boolean) from public, anon;
grant execute on function public.preview_suggested_price(uuid, text, numeric, text, text, boolean) to authenticated;
