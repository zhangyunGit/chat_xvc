ALTER TABLE users ADD COLUMN profile_status TEXT NOT NULL DEFAULT 'pending';

UPDATE users
SET profile_status = 'completed'
WHERE name IS NOT NULL AND TRIM(name) <> '';
