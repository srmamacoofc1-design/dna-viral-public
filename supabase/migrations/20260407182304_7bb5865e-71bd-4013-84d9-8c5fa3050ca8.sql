-- Admin roles are deployment data, not portable schema data. A fresh project
-- may not contain any auth.users row yet, so this migration intentionally does
-- not depend on an external user's UUID. Assign the first admin explicitly
-- after that user signs up, using the project's protected administration flow.
DO $$
BEGIN
  NULL;
END;
$$;
