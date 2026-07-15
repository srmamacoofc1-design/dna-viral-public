-- Approval-bearing generation outputs are written by Edge Functions with the
-- service role or by an explicitly trusted administrator. A regular member
-- must never INSERT/UPDATE its own assembly because that would let the browser
-- forge validation_status and writer_evaluator_loop.passed.

ALTER TABLE public.script_assemblies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public insert script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public update script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public delete script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Members see own script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Members insert own script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Members update own script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_select_own_or_admin" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_insert_own_or_admin" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_update_own_or_admin" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_delete_admin_only" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_insert_admin_only" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_update_admin_only" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_insert_admin_only" ON public.script_assemblies;
DROP POLICY IF EXISTS "sa_update_admin_only" ON public.script_assemblies;

CREATE POLICY "sa_select_own_or_admin"
  ON public.script_assemblies FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_insert_admin_only"
  ON public.script_assemblies FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_update_admin_only"
  ON public.script_assemblies FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_delete_admin_only"
  ON public.script_assemblies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Promoted scripts must likewise come from promote-script-final. Members keep
-- read access to their own final scripts, but cannot manufacture one directly.
ALTER TABLE public.promoted_scripts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public all promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members see own promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members insert own promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members update own promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_select_own_or_admin" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_insert_own_or_admin" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_update_own_or_admin" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_delete_admin_only" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_insert_admin_only" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_update_admin_only" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_insert_admin_only" ON public.promoted_scripts;
DROP POLICY IF EXISTS "ps_update_admin_only" ON public.promoted_scripts;

CREATE POLICY "ps_select_own_or_admin"
  ON public.promoted_scripts FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_insert_admin_only"
  ON public.promoted_scripts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_update_admin_only"
  ON public.promoted_scripts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_delete_admin_only"
  ON public.promoted_scripts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
