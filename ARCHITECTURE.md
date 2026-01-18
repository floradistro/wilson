# Wilson Auto-Configuration Architecture

## Overview

Wilson now features **zero-configuration automatic setup** - users never need to manually set environment variables or configure credentials. Everything is handled automatically via database-backed configuration and secure bootstrap endpoints.

## How It Works

### 1. **Database-Level Configuration**

Every store automatically gets:
- `store_config` entry with settings and context
- `store_prefetch_data` with cached products, inventory, sales
- Auto-refresh via background jobs (every 15 minutes)

#### Schema

```sql
-- Configuration storage
CREATE TABLE store_config (
  store_id UUID UNIQUE,
  config JSONB,              -- Non-sensitive settings
  wilson_context JSONB,      -- Pre-computed context
  features JSONB             -- Feature flags
);

-- Cached data storage
CREATE TABLE store_prefetch_data (
  store_id UUID,
  data_type TEXT,            -- 'products', 'inventory', 'sales_summary'
  data JSONB,                -- Actual cached data
  expires_at TIMESTAMPTZ     -- Cache expiry
);
```

#### Auto-Population

When a store is created:
1. Trigger automatically creates `store_config` entry
2. Function `refresh_store_prefetch()` caches initial data
3. Background cron job keeps data fresh (15min intervals)

### 2. **Bootstrap Endpoint**

**Endpoint:** `/functions/v1/wilson-bootstrap`

**Authentication:** User's access token (from login)

**What It Returns:**
```json
{
  "success": true,
  "store": {
    "id": "uuid",
    "name": "Store Name",
    "role": "owner"
  },
  "config": {
    "context": { ... },
    "endpoints": { ... }
  },
  "prefetchData": {
    "top_products": [...],
    "inventory_summary": {...},
    "sales_summary": {...}
  },
  "features": {
    "wilson_enabled": true,
    "offline_mode": true
  },
  "session": {
    "id": "session-uuid",
    "expiresAt": "2026-01-18T12:00:00Z"
  }
}
```

**Security:**
- Protected by RLS (Row Level Security)
- Users can only access their own store's data
- No global service keys exposed to clients
- Uses user's scoped access token

### 3. **Client-Side Bootstrap Flow**

```typescript
// 1. User runs `wilson`
// 2. Check ~/.wilson/auth.json for saved credentials
// 3. If authenticated → bootstrap()
// 4. If not authenticated → show login screen

async function bootstrap(accessToken: string) {
  // Try cache first (15min TTL)
  const cached = loadCachedBootstrap();
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  // Fetch fresh from backend
  const response = await fetch('/wilson-bootstrap', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const data = await response.json();

  // Cache locally for offline use
  cacheBootstrap(data);

  return data;
}
```

**Caching Strategy:**
- Fresh data cached in `~/.wilson/bootstrap.json`
- 15-minute TTL (configurable)
- Falls back to cache if API unavailable (offline mode)
- Cleared on logout

### 4. **Automatic Credential Management**

**Problem Solved:**
- ❌ No manual `.env` file creation
- ❌ No manual environment variable setup
- ❌ No hardcoded credentials
- ❌ No user-visible API keys

**How:**
1. User logs in with email/password ONCE
2. Backend returns access token + refresh token
3. Wilson saves to `~/.wilson/auth.json`
4. Bootstrap endpoint provides everything else
5. All future sessions auto-authenticated

**Stored in ~/.wilson/auth.json:**
```json
{
  "accessToken": "jwt...",
  "refreshToken": "jwt...",
  "expiresAt": 1234567890,
  "user": { "id": "...", "email": "..." },
  "storeId": "uuid",
  "storeName": "My Store"
}
```

### 5. **Prefetch Data Usage**

Wilson intelligently uses prefetch data to avoid unnecessary API calls:

```typescript
// Check prefetch before querying API
const cachedProducts = getPrefetchData(bootstrap, 'top_products');

if (cachedProducts && !forceRefresh) {
  // Use cached data
  return cachedProducts;
} else {
  // Fetch fresh from API
  return await fetchProducts();
}
```

**What's Prefetched:**
- ✅ Top 50 products (by inventory)
- ✅ Inventory summary (totals, low stock count)
- ✅ Sales summary (30-day metrics)
- ✅ Store context (name, categories, etc.)

**Refresh Strategy:**
- Auto-refresh every 15 minutes (background job)
- Manual refresh via `/refresh` command
- Fetch fresh on explicit user queries

### 6. **Security Model**

#### No Global Service Keys on Client

Wilson NEVER receives or stores:
- `SUPABASE_SERVICE_KEY` (backend-only)
- Global admin credentials
- Other stores' data

#### Row Level Security (RLS)

Every database table has policies:
```sql
-- Users can only read their own store's config
CREATE POLICY "Users can read their store config"
  ON store_config FOR SELECT
  USING (
    store_id IN (
      SELECT store_id FROM users
      WHERE auth_user_id = auth.uid()
    )
  );
```

#### Scoped Access Tokens

User's JWT token from Supabase Auth:
- Scoped to their user ID
- RLS automatically filters queries
- Cannot access other stores' data
- Auto-expires and refreshes

### 7. **Offline Mode**

Wilson works offline using cached data:

1. **When Online:**
   - Bootstrap from API
   - Cache response locally
   - Use fresh data

2. **When Offline:**
   - Detect API failure
   - Fall back to `~/.wilson/bootstrap.json`
   - Show "offline mode" indicator
   - Use prefetch data for queries

3. **Graceful Degradation:**
   - File operations work offline (local tools)
   - Queries use cached prefetch data
   - API calls queued for later (optional)

### 8. **Zero-Configuration Setup**

**For Users:**
```bash
# Install
npm install -g wilson

# First run - login once
wilson
# → Prompts for email/password
# → Saves credentials
# → Bootstraps configuration
# → Ready to use

# All future runs - automatic
wilson "show me sales"
# → Auto-authenticated
# → Auto-configured
# → Just works
```

**For New Stores:**
```sql
-- Admin creates store
INSERT INTO stores (store_name) VALUES ('New Store');

-- Trigger automatically:
-- 1. Creates store_config entry
-- 2. Populates default settings
-- 3. Pre-fetches initial data
-- 4. Ready for Wilson immediately
```

### 9. **Configuration Precedence**

Wilson checks multiple sources (in order):

1. **Environment Variables** (highest priority)
   - `WILSON_API_URL`
   - `WILSON_ANON_KEY`
   - `WILSON_SERVICE_KEY` (if provided)

2. **User Config File**
   - `~/.wilson/config.json`
   - Manual overrides

3. **Bootstrap Endpoint** (default)
   - Auto-loaded after auth
   - Database-backed config
   - Store-specific settings

4. **Cached Bootstrap** (offline fallback)
   - `~/.wilson/bootstrap.json`
   - Last successful bootstrap
   - Stale data acceptable for offline mode

### 10. **Future Enhancements**

- [ ] **Multi-Store Support**: Switch between stores via `/switch`
- [ ] **Team Sharing**: Share cached queries with team members
- [ ] **Sync Conflicts**: Handle concurrent updates gracefully
- [ ] **Compression**: gzip bootstrap payload for mobile users
- [ ] **Delta Updates**: Only fetch changed data on refresh
- [ ] **Smart Prefetch**: ML-based prediction of needed data

## Benefits

### For Users
- ✅ Zero manual configuration
- ✅ Works offline (cached data)
- ✅ Secure (no exposed credentials)
- ✅ Fast (prefetch reduces API calls)
- ✅ Multi-device (auth syncs across devices)

### For Developers
- ✅ No hardcoded credentials
- ✅ Per-store configuration
- ✅ Easy deployment (no env vars needed)
- ✅ Centralized config management
- ✅ RLS enforced security

### For Operations
- ✅ Database-backed config (easy updates)
- ✅ Automatic cache refresh (no stale data)
- ✅ Monitoring via sessions table
- ✅ Graceful degradation (offline mode)
- ✅ Scalable (RLS handles multi-tenancy)

## File Locations

```
~/.wilson/
├── auth.json          # Saved login credentials
├── bootstrap.json     # Cached configuration & prefetch data
├── config.json        # Optional user overrides
└── logs/              # Session logs (optional)
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/auth/v1/token` | POST | User login (Supabase Auth) |
| `/functions/v1/wilson-bootstrap` | GET | Load configuration & prefetch data |
| `/functions/v1/agentic-loop` | POST | Chat/query processing |
| `/rest/v1/store_config` | GET | Direct config access (RLS protected) |
| `/rest/v1/store_prefetch_data` | GET | Direct prefetch access (RLS protected) |

## Database Functions

| Function | Trigger | Purpose |
|----------|---------|---------|
| `create_default_store_config()` | On store insert | Auto-create config |
| `refresh_store_prefetch(store_id)` | Manual/cron | Update cached data |
| `refresh_all_stores_prefetch()` | Cron (15min) | Batch refresh all stores |

## Conclusion

This architecture ensures:
1. **Users never touch environment variables**
2. **Configuration is database-backed and automatic**
3. **Security is enforced via RLS, not client-side checks**
4. **Offline mode works with cached data**
5. **Scalable to thousands of stores**

Wilson "just works" out of the box.
