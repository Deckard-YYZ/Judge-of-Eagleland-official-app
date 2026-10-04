CREATE TABLE profile_tutorials (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(profile_id) ON DELETE CASCADE,
    completed INTEGER NOT NULL CHECK (completed IN (0, 1))
);

-- Existing accounts have already entered the application before this feature.
INSERT INTO profile_tutorials (profile_id, completed)
SELECT profile_id, 1 FROM profiles;

CREATE TRIGGER initialize_profile_tutorial AFTER INSERT ON profiles
BEGIN
    INSERT INTO profile_tutorials (profile_id, completed) VALUES (NEW.profile_id, 0);
END;
