/**
 * Wilson Bootstrap Endpoint
 *
 * Returns everything Wilson needs to run:
 * - Store configuration
 * - Pre-fetched data (products, inventory, sales)
 * - Environment variables (safe subset)
 * - User permissions
 *
 * Security: Protected by RLS - users can only access their own store's data
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

interface BootstrapResponse {
  success: boolean;
  store: {
    id: string;
    name: string;
    role: string;
  };
  config: Record<string, any>;
  prefetchData: {
    products?: any;
    inventory?: any;
    sales?: any;
  };
  features: Record<string, boolean>;
  session: {
    id: string;
    expiresAt: string;
  };
}

Deno.serve(async (req) => {
  // CORS headers
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // Get auth token from request
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Missing authorization header' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Create authenticated Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Get authenticated user
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Get user's store info (RLS protects this)
    const { data: userData, error: userError } = await supabase
      .from('users')
      .select('id, store_id, role, stores(id, store_name)')
      .eq('auth_user_id', user.id)
      .single();

    if (userError || !userData?.store_id) {
      return new Response(
        JSON.stringify({ error: 'User not associated with a store' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const storeId = userData.store_id;

    // Get store configuration (RLS ensures user can only access their store)
    const { data: config, error: configError } = await supabase
      .from('store_config')
      .select('config, wilson_context, features')
      .eq('store_id', storeId)
      .single();

    if (configError) {
      console.error('Config fetch error:', configError);
    }

    // Get all prefetch data that hasn't expired (RLS applies)
    const { data: prefetchData, error: prefetchError } = await supabase
      .from('store_prefetch_data')
      .select('data_type, data, expires_at')
      .eq('store_id', storeId)
      .gt('expires_at', new Date().toISOString());

    if (prefetchError) {
      console.error('Prefetch data error:', prefetchError);
    }

    // Organize prefetch data by type
    const organizedPrefetch: Record<string, any> = {};
    if (prefetchData) {
      for (const item of prefetchData) {
        organizedPrefetch[item.data_type] = item.data;
      }
    }

    // Create or update Wilson session
    const { data: session } = await supabase
      .from('wilson_sessions')
      .upsert({
        user_id: user.id,
        store_id: storeId,
        device_info: {
          platform: req.headers.get('x-platform') || 'unknown',
          client: req.headers.get('x-client-info') || 'wilson-cli',
        },
        last_seen_at: new Date().toISOString(),
      }, {
        onConflict: 'user_id,store_id',
        ignoreDuplicates: false,
      })
      .select('id')
      .single();

    // Increment queries count
    if (session?.id) {
      await supabase.rpc('increment_wilson_queries', { session_id: session.id });
    }

    // Build response
    const response: BootstrapResponse = {
      success: true,
      store: {
        id: storeId,
        name: (userData.stores as any)?.store_name || 'Unknown Store',
        role: userData.role || 'user',
      },
      config: {
        // Safe configuration (no secrets)
        ...(config?.config || {}),
        // Wilson-specific context
        context: config?.wilson_context || {},
        // API endpoints (user only needs to know their own store's scoped endpoints)
        endpoints: {
          supabase_url: supabaseUrl,
          // Don't send keys - user already has them from auth
        },
      },
      prefetchData: organizedPrefetch,
      features: config?.features || {},
      session: {
        id: session?.id || '',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
      },
    };

    return new Response(
      JSON.stringify(response),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store, must-revalidate',
        },
      }
    );

  } catch (error) {
    console.error('Bootstrap error:', error);
    return new Response(
      JSON.stringify({
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
