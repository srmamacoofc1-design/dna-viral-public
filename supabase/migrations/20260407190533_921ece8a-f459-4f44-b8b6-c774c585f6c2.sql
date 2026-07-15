
-- ================================================================
-- CORREÇÃO CRÍTICA: Remover policies inseguras e recriar seguras
-- Tabelas: reference_videos, reference_generation_runs,
--          generation_contexts, script_assemblies, promoted_scripts
-- ================================================================

-- ────────────────────────────────────────────
-- 1. reference_videos
-- ────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public all reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members insert own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members see own reference_videos" ON public.reference_videos;
DROP POLICY IF EXISTS "Members update own reference_videos" ON public.reference_videos;

CREATE POLICY "rv_select_own_or_admin"
  ON public.reference_videos FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_insert_own_or_admin"
  ON public.reference_videos FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_update_own_or_admin"
  ON public.reference_videos FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rv_delete_admin_only"
  ON public.reference_videos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ────────────────────────────────────────────
-- 2. reference_generation_runs
-- ────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public all reference_generation_runs" ON public.reference_generation_runs;
DROP POLICY IF EXISTS "Members insert own runs" ON public.reference_generation_runs;
DROP POLICY IF EXISTS "Members see own runs" ON public.reference_generation_runs;
DROP POLICY IF EXISTS "Members update own runs" ON public.reference_generation_runs;

CREATE POLICY "rgr_select_own_or_admin"
  ON public.reference_generation_runs FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rgr_insert_own_or_admin"
  ON public.reference_generation_runs FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rgr_update_own_or_admin"
  ON public.reference_generation_runs FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "rgr_delete_admin_only"
  ON public.reference_generation_runs FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ────────────────────────────────────────────
-- 3. generation_contexts
-- ────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public delete generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Allow public insert generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Allow public read generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Allow public update generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Members insert own generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Members see own generation_contexts" ON public.generation_contexts;
DROP POLICY IF EXISTS "Members update own generation_contexts" ON public.generation_contexts;

CREATE POLICY "gc_select_own_or_admin"
  ON public.generation_contexts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "gc_insert_own_or_admin"
  ON public.generation_contexts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "gc_update_own_or_admin"
  ON public.generation_contexts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "gc_delete_admin_only"
  ON public.generation_contexts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ────────────────────────────────────────────
-- 4. script_assemblies
-- ────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public delete script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public insert script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public read script_assemblies" ON public.script_assemblies;
DROP POLICY IF EXISTS "Allow public update script_assemblies" ON public.script_assemblies;

CREATE POLICY "sa_select_own_or_admin"
  ON public.script_assemblies FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_insert_own_or_admin"
  ON public.script_assemblies FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_update_own_or_admin"
  ON public.script_assemblies FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "sa_delete_admin_only"
  ON public.script_assemblies FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- ────────────────────────────────────────────
-- 5. promoted_scripts
-- ────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow public all promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members insert own promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members see own promoted_scripts" ON public.promoted_scripts;
DROP POLICY IF EXISTS "Members update own promoted_scripts" ON public.promoted_scripts;

CREATE POLICY "ps_select_own_or_admin"
  ON public.promoted_scripts FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_insert_own_or_admin"
  ON public.promoted_scripts FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_update_own_or_admin"
  ON public.promoted_scripts FOR UPDATE TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "ps_delete_admin_only"
  ON public.promoted_scripts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
