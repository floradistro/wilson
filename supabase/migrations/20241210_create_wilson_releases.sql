-- Create wilson_releases table for OTA updates
CREATE TABLE IF NOT EXISTS wilson_releases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  version TEXT NOT NULL UNIQUE,
  download_url TEXT NOT NULL,
  changelog TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_latest BOOLEAN DEFAULT FALSE,
  is_stable BOOLEAN DEFAULT TRUE,
  min_compatible_version TEXT,
  size_bytes BIGINT,
  checksum TEXT
);

-- Create index on version for quick lookups
CREATE INDEX IF NOT EXISTS idx_wilson_releases_version ON wilson_releases(version);
CREATE INDEX IF NOT EXISTS idx_wilson_releases_latest ON wilson_releases(is_latest, is_stable);

-- Create storage bucket for releases
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wilson-releases',
  'wilson-releases', 
  true,
  104857600, -- 100MB limit
  ARRAY['application/gzip', 'application/x-gzip', 'application/x-tar', 'application/octet-stream']
)
ON CONFLICT (id) DO NOTHING;

-- Create RLS policies
ALTER TABLE wilson_releases ENABLE ROW LEVEL SECURITY;

-- Allow read access to all authenticated users
CREATE POLICY "Allow read access to wilson releases" ON wilson_releases
  FOR SELECT USING (TRUE);

-- Only allow inserts from service role (GitHub Actions)
CREATE POLICY "Allow insert from service role" ON wilson_releases
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Only allow updates from service role
CREATE POLICY "Allow update from service role" ON wilson_releases
  FOR UPDATE USING (auth.role() = 'service_role');

-- Function to automatically set is_latest = false for other releases when a new latest is inserted
CREATE OR REPLACE FUNCTION update_latest_release()
RETURNS TRIGGER AS $$
BEGIN
  -- If this release is being marked as latest, unmark all others
  IF NEW.is_latest = TRUE THEN
    UPDATE wilson_releases 
    SET is_latest = FALSE 
    WHERE id != NEW.id AND is_latest = TRUE;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger
DROP TRIGGER IF EXISTS trigger_update_latest_release ON wilson_releases;
CREATE TRIGGER trigger_update_latest_release
  BEFORE INSERT OR UPDATE ON wilson_releases
  FOR EACH ROW
  EXECUTE FUNCTION update_latest_release();

-- Insert initial release (if none exists)
INSERT INTO wilson_releases (version, download_url, changelog, is_latest, is_stable)
VALUES (
  '1.0.0',
  'https://github.com/floradistro/wilson/releases/download/v1.0.0/wilson-1.0.0.tar.gz',
  'Initial release with OTA update support',
  true,
  true
)
ON CONFLICT (version) DO NOTHING;