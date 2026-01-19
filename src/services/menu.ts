/**
 * Menu Service - Fetches CLI menu configuration from backend
 */

import { config } from '../config.js';

export interface MenuItem {
  id: string;
  menu_type: 'main' | 'slash';
  item_id: string;
  label: string;
  icon?: string;
  description?: string;
  action: string;
  value?: string;
  shortcut?: string;
  sort_order: number;
  is_active: boolean;
  requires_feature?: string;
}

export interface MenuConfig {
  main: MenuItem[];
  slash: MenuItem[];
}

// Default fallback menu if backend is unavailable
const DEFAULT_MENU: MenuConfig = {
  main: [
    { id: '1', menu_type: 'main', item_id: 'new_chat', label: 'New Chat', icon: '+', description: 'Start a new conversation', action: 'view', value: 'new_chat', shortcut: 'n', sort_order: 10, is_active: true },
    { id: '2', menu_type: 'main', item_id: 'locations', label: 'Switch Location', icon: '◇', description: 'Change current location', action: 'view', value: 'locations', shortcut: 'l', sort_order: 50, is_active: true },
    { id: '3', menu_type: 'main', item_id: 'stores', label: 'Switch Store', icon: '◈', description: 'Change current store', action: 'view', value: 'stores', shortcut: 's', sort_order: 55, is_active: true },
  ],
  slash: [
    { id: '10', menu_type: 'slash', item_id: 'new', label: 'new', description: 'Start fresh conversation', action: 'command', value: '/new', sort_order: 10, is_active: true },
    { id: '11', menu_type: 'slash', item_id: 'stores', label: 'stores', description: 'Switch store', action: 'command', value: '/stores', sort_order: 20, is_active: true },
    { id: '12', menu_type: 'slash', item_id: 'config', label: 'config', description: 'View current settings', action: 'command', value: '/config', sort_order: 22, is_active: true },
    { id: '13', menu_type: 'slash', item_id: 'config edit', label: 'config edit', description: 'Edit settings.json', action: 'command', value: '/config edit', sort_order: 23, is_active: true },
    { id: '14', menu_type: 'slash', item_id: 'rules', label: 'rules', description: 'View WILSON.md rules', action: 'command', value: '/rules', sort_order: 24, is_active: true },
    { id: '15', menu_type: 'slash', item_id: 'rules edit', label: 'rules edit', description: 'Edit WILSON.md', action: 'command', value: '/rules edit', sort_order: 25, is_active: true },
    { id: '16', menu_type: 'slash', item_id: 'location', label: 'location', description: 'Switch location', action: 'command', value: '/location', sort_order: 30, is_active: true },
    { id: '17', menu_type: 'slash', item_id: 'refresh', label: 'refresh', description: 'Sync from server', action: 'command', value: '/refresh', sort_order: 35, is_active: true },
    { id: '18', menu_type: 'slash', item_id: 'context', label: 'context', description: 'Show context usage', action: 'command', value: '/context', sort_order: 40, is_active: true },
    { id: '19', menu_type: 'slash', item_id: 'tokens', label: 'tokens', description: 'Show token usage', action: 'command', value: '/tokens', sort_order: 45, is_active: true },
    { id: '20', menu_type: 'slash', item_id: 'status', label: 'status', description: 'View status', action: 'command', value: '/status', sort_order: 50, is_active: true },
    { id: '21', menu_type: 'slash', item_id: 'help', label: 'help', description: 'Show help', action: 'command', value: '/help', sort_order: 55, is_active: true },
    { id: '22', menu_type: 'slash', item_id: 'logout', label: 'logout', description: 'Sign out', action: 'command', value: '/logout', sort_order: 100, is_active: true },
  ],
};

let cachedMenu: MenuConfig | null = null;

/**
 * Fetch menu configuration from backend
 */
export async function fetchMenuConfig(storeId?: string, accessToken?: string): Promise<MenuConfig> {
  try {
    // Use user's access token for RLS, fallback to anon key
    const authToken = accessToken || config.anonKey;

    // Build query - get store-specific and global items
    let url = `${config.apiUrl}/rest/v1/cli_menu_config?is_active=eq.true&order=sort_order.asc`;

    if (storeId) {
      url += `&or=(store_id.eq.${storeId},store_id.is.null)`;
    } else {
      url += `&store_id=is.null`;
    }

    const response = await fetch(url, {
      headers: {
        'apikey': config.anonKey,
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      console.error('Failed to fetch menu:', response.status);
      return cachedMenu || DEFAULT_MENU;
    }

    const data: MenuItem[] = await response.json();

    // Deduplicate: store-specific items override global defaults
    const menuMap = new Map<string, MenuItem>();

    // First add global items (no store_id)
    data.filter(item => !(item as any).store_id).forEach(item => {
      menuMap.set(`${item.menu_type}:${item.item_id}`, item);
    });

    // Then override with store-specific items
    data.filter(item => (item as any).store_id).forEach(item => {
      menuMap.set(`${item.menu_type}:${item.item_id}`, item);
    });

    const items = Array.from(menuMap.values());

    cachedMenu = {
      main: items.filter(i => i.menu_type === 'main').sort((a, b) => a.sort_order - b.sort_order),
      slash: items.filter(i => i.menu_type === 'slash').sort((a, b) => a.sort_order - b.sort_order),
    };

    return cachedMenu;
  } catch (error) {
    console.error('Menu fetch error:', error);
    return cachedMenu || DEFAULT_MENU;
  }
}

/**
 * Get cached menu or fetch if not available
 */
export function getMenuConfig(): MenuConfig {
  return cachedMenu || DEFAULT_MENU;
}

/**
 * Clear cached menu (call when switching stores)
 */
export function clearMenuCache(): void {
  cachedMenu = null;
}

/**
 * Convert backend slash commands to Command format for CommandMenu
 */
export function getSlashCommands(): Array<{ name: string; aliases: string[]; description: string }> {
  const menu = getMenuConfig();
  return menu.slash.map(item => ({
    name: item.item_id,
    aliases: [], // Could be extended to support aliases from backend
    description: item.description || '',
  }));
}
