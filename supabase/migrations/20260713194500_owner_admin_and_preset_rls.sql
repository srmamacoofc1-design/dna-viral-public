-- The public distribution never promotes a fixed email address. New projects
-- bootstrap every account as a member; an owner can promote one reviewed
-- account explicitly after signup through the Supabase SQL editor.

-- Legacy uniqueness allowed both member and admin for the same user. Keep the
-- strongest role and make role resolution deterministic at the database level.
DELETE FROM public.user_roles AS member_role
USING public.user_roles AS admin_role
WHERE member_role.user_id = admin_role.user_id
  AND member_role.role = 'member'
  AND admin_role.role = 'admin';

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_one_role_per_user_idx
  ON public.user_roles (user_id);

-- Presets/cohorts are shared training configuration. Everyone authenticated may
-- read them, but only an administrator may change the active DNA corpus.
DROP POLICY IF EXISTS "Allow public all dataset_cohort" ON public.dataset_cohort;
DROP POLICY IF EXISTS "dataset_cohort_read_authenticated" ON public.dataset_cohort;
DROP POLICY IF EXISTS "dataset_cohort_insert_admin" ON public.dataset_cohort;
DROP POLICY IF EXISTS "dataset_cohort_update_admin" ON public.dataset_cohort;
DROP POLICY IF EXISTS "dataset_cohort_delete_admin" ON public.dataset_cohort;

CREATE POLICY "dataset_cohort_read_authenticated"
  ON public.dataset_cohort FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "dataset_cohort_insert_admin"
  ON public.dataset_cohort FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "dataset_cohort_update_admin"
  ON public.dataset_cohort FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "dataset_cohort_delete_admin"
  ON public.dataset_cohort FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Allow public all dataset_cohort_videos" ON public.dataset_cohort_videos;
DROP POLICY IF EXISTS "dataset_cohort_videos_read_authenticated" ON public.dataset_cohort_videos;
DROP POLICY IF EXISTS "dataset_cohort_videos_insert_admin" ON public.dataset_cohort_videos;
DROP POLICY IF EXISTS "dataset_cohort_videos_update_admin" ON public.dataset_cohort_videos;
DROP POLICY IF EXISTS "dataset_cohort_videos_delete_admin" ON public.dataset_cohort_videos;

CREATE POLICY "dataset_cohort_videos_read_authenticated"
  ON public.dataset_cohort_videos FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "dataset_cohort_videos_insert_admin"
  ON public.dataset_cohort_videos FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "dataset_cohort_videos_update_admin"
  ON public.dataset_cohort_videos FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "dataset_cohort_videos_delete_admin"
  ON public.dataset_cohort_videos FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
