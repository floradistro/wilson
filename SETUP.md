# Wilson Auto-Configuration Setup Guide

## Quick Start (5 Minutes)

### 1. Run the Migration

Apply the auto-configuration schema to your database:

```bash
cd /Users/whale/Desktop/wilson

# If using Supabase CLI
supabase db push supabase/migrations/20260117_wilson_auto_config.sql

# Or execute directly via psql
psql "$DATABASE_URL" -f supabase/migrations/20260117_wilson_auto_config.sql
```

**This migration:**
- ✅ Creates `store_config` table
- ✅ Creates `store_prefetch_data` table
- ✅ Creates `wilson_sessions` table
- ✅ Sets up RLS policies
- ✅ Creates auto-population triggers
- ✅ Pre-fetches data for existing stores

### 2. Deploy the Bootstrap Edge Function

```bash
cd /Users/whale/Desktop/wilson

# Deploy to Supabase
supabase functions deploy wilson-bootstrap

# Verify deployment
curl -H "Authorization: Bearer YOUR_USER_TOKEN" \
  https://your-project.supabase.co/functions/v1/wilson-bootstrap
```

### 3. Set Up Auto-Refresh Cron Job

**Option A: Using pg_cron (Recommended)**

```sql
-- Enable pg_cron extension (if not already enabled)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule auto-refresh every 15 minutes
SELECT cron.schedule(
  'refresh-wilson-prefetch',
  '*/15 * * * *',
  'SELECT refresh_all_stores_prefetch()'
);

-- Verify cron job
SELECT * FROM cron.job WHERE jobname = 'refresh-wilson-prefetch';
```

**Option B: Using External Scheduler (GitHub Actions, etc.)**

```yaml
# .github/workflows/refresh-wilson.yml
name: Refresh Wilson Prefetch Data
on:
  schedule:
    - cron: '*/15 * * * *'  # Every 15 minutes
jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -X POST \
            -H "apikey: ${{ secrets.SUPABASE_SERVICE_KEY }}" \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_KEY }}" \
            "https://your-project.supabase.co/rest/v1/rpc/refresh_all_stores_prefetch"
```

### 4. Test the Setup

```bash
# Install Wilson CLI
cd /Users/whale/Desktop/wilson
bun link
bun run build

# Test login & bootstrap
wilson
# → Should prompt for login
# → After login, should bootstrap automatically
# → Should show "Connected" status
```

### 5. Verify Bootstrap Data

```sql
-- Check store configs were created
SELECT store_id, created_at, features
FROM store_config
ORDER BY created_at DESC;

-- Check prefetch data
SELECT store_id, data_type, expires_at
FROM store_prefetch_data
ORDER BY updated_at DESC;

-- Check bootstrap is working
SELECT
  s.store_name,
  sc.created_at as config_created,
  COUNT(spd.id) as prefetch_count
FROM stores s
LEFT JOIN store_config sc ON s.id = sc.store_id
LEFT JOIN store_prefetch_data spd ON s.id = spd.store_id
GROUP BY s.id, s.store_name, sc.created_at
ORDER BY s.store_name;
```

## Configuration

### Environment Variables (Optional)

Wilson works without any environment variables, but you can override defaults:

```bash
# Optional overrides
export WILSON_API_URL="https://custom.supabase.co"
export WILSON_ANON_KEY="your-anon-key"

# Token pricing (for cost tracking)
export WILSON_TOKEN_PRICE_INPUT="0.000003"    # $3 per 1M input tokens
export WILSON_TOKEN_PRICE_OUTPUT="0.000015"   # $15 per 1M output tokens

# Context window settings
export WILSON_CONTEXT_MAX="200000"            # 200K tokens
export WILSON_COMPACTION_THRESHOLD="0.8"      # Compact at 80% full
```

### User Config File (Optional)

Users can override settings in `~/.wilson/config.json`:

```json
{
  "apiUrl": "https://custom.supabase.co",
  "anonKey": "custom-key",
  "tokenPricing": {
    "input": 0.000003,
    "output": 0.000015
  }
}
```

### Store-Level Configuration

Configure per-store settings in the database:

```sql
-- Enable/disable Wilson for a store
UPDATE store_config
SET features = features || '{"wilson_enabled": false}'::jsonb
WHERE store_id = 'your-store-id';

-- Disable auto-prefetch for a store
UPDATE store_config
SET features = features || '{"auto_prefetch": false}'::jsonb
WHERE store_id = 'your-store-id';

-- Add custom context
UPDATE store_config
SET wilson_context = wilson_context || '{
  "custom_field": "custom value",
  "business_hours": "9am-5pm PST"
}'::jsonb
WHERE store_id = 'your-store-id';
```

## Adding New Prefetch Data Types

Want to prefetch additional data? Add it to the `refresh_store_prefetch()` function:

```sql
-- Add new prefetch type: recent_orders
INSERT INTO store_prefetch_data (store_id, data_type, data, expires_at)
SELECT
  p_store_id,
  'recent_orders',
  jsonb_agg(jsonb_build_object(
    'id', o.id,
    'customer', o.customer_name,
    'total', o.final_price,
    'date', o.created_at
  ) ORDER BY o.created_at DESC LIMIT 20),
  NOW() + INTERVAL '10 minutes'
FROM orders o
WHERE o.store_id = p_store_id
  AND o.created_at > NOW() - INTERVAL '7 days'
ON CONFLICT (store_id, data_type)
DO UPDATE SET
  data = EXCLUDED.data,
  updated_at = NOW(),
  expires_at = EXCLUDED.expires_at;
```

Then update the function definition to include this new INSERT.

## Monitoring

### Check Prefetch Freshness

```sql
-- Find stale prefetch data
SELECT
  s.store_name,
  spd.data_type,
  spd.updated_at,
  spd.expires_at,
  CASE
    WHEN spd.expires_at < NOW() THEN 'Expired'
    WHEN spd.expires_at < NOW() + INTERVAL '5 minutes' THEN 'Expiring Soon'
    ELSE 'Fresh'
  END as status
FROM store_prefetch_data spd
JOIN stores s ON s.id = spd.store_id
ORDER BY spd.expires_at ASC;
```

### Track Wilson Usage

```sql
-- Active Wilson users (last 24h)
SELECT
  u.email,
  s.store_name,
  ws.last_seen_at,
  ws.queries_count,
  ws.device_info->>'platform' as platform
FROM wilson_sessions ws
JOIN users u ON u.auth_user_id = ws.user_id
JOIN stores s ON s.id = ws.store_id
WHERE ws.last_seen_at > NOW() - INTERVAL '24 hours'
ORDER BY ws.last_seen_at DESC;
```

### Bootstrap Performance

```sql
-- Check bootstrap endpoint response times (via Supabase logs)
-- This requires access to Supabase Edge Function logs
```

## Troubleshooting

### "Failed to bootstrap" Error

**Cause:** Wilson can't reach bootstrap endpoint

**Fix:**
```bash
# 1. Check internet connection
curl https://your-project.supabase.co/functions/v1/wilson-bootstrap

# 2. Verify edge function is deployed
supabase functions list

# 3. Check access token is valid
# Login again: wilson logout && wilson
```

### "No prefetch data available"

**Cause:** Prefetch hasn't run yet or failed

**Fix:**
```sql
-- Manually trigger prefetch
SELECT refresh_store_prefetch('your-store-id');

-- Check for errors
SELECT * FROM store_prefetch_data WHERE store_id = 'your-store-id';
```

### "Unauthorized" on Bootstrap

**Cause:** Invalid access token or RLS policy issue

**Fix:**
```sql
-- Verify RLS policies exist
SELECT * FROM pg_policies
WHERE tablename IN ('store_config', 'store_prefetch_data');

-- Check user has store_id
SELECT * FROM users WHERE auth_user_id = auth.uid();
```

### Offline Mode Not Working

**Cause:** Cache file doesn't exist or is corrupt

**Fix:**
```bash
# Check cache file
cat ~/.wilson/bootstrap.json

# Force fresh bootstrap
rm ~/.wilson/bootstrap.json
wilson
```

## Migration from Old Wilson

If you have existing Wilson installations using `.env` files:

### 1. Keep Existing `.env` (Optional)

The new Wilson is backward compatible. If `.env` exists, it will use those values. But bootstrap will override them after login.

### 2. Migrate Users

All users need to login once to bootstrap:

```bash
# Each user runs:
rm ~/.wilson/auth.json  # Clear old auth (optional)
wilson                  # Login & bootstrap
```

### 3. Remove `.env` Files (Optional)

After all users have bootstrapped:

```bash
# No longer needed
rm /Users/whale/Desktop/wilson/.env
rm /Users/whale/Desktop/wilson/.env.example
```

## Security Checklist

- [ ] RLS policies enabled on all tables
- [ ] Bootstrap endpoint requires authentication
- [ ] Service key never exposed to clients
- [ ] Access tokens auto-expire and refresh
- [ ] Cached data stored with proper permissions (`~/.wilson/` is user-only)
- [ ] Edge functions deployed with secure environment

## Performance Optimization

### Reduce Bootstrap Payload Size

```sql
-- Limit prefetch data to essential fields only
-- In refresh_store_prefetch(), select fewer columns:
jsonb_agg(jsonb_build_object(
  'id', p.id,
  'name', p.product_name,
  'price', p.price
  -- Removed: inventory, description, images, etc.
) ORDER BY p.inventory DESC LIMIT 20)  -- Reduced from 50 to 20
```

### Increase Cache TTL for Stable Data

```typescript
// In src/services/bootstrap.ts
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour instead of 15 minutes
```

### Use CDN for Bootstrap Endpoint (Advanced)

Deploy bootstrap behind Cloudflare or similar CDN to cache responses per-user.

## Next Steps

1. ✅ Run migration
2. ✅ Deploy edge function
3. ✅ Set up cron job
4. ✅ Test with `wilson` command
5. 📚 Read [ARCHITECTURE.md](./ARCHITECTURE.md) for technical details
6. 🚀 Roll out to users

## Support

If you encounter issues:
1. Check logs: `supabase functions logs wilson-bootstrap`
2. Verify migration: `psql -c "\d store_config"`
3. Test manually: `SELECT refresh_store_prefetch('store-id')`
4. Review [ARCHITECTURE.md](./ARCHITECTURE.md)

Wilson should now be fully automatic and zero-configuration! 🎉
