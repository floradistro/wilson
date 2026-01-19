import type { Tool, ToolResult, ToolSchema } from '../types.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// =============================================================================
// Location Context Management
// Allows Wilson to switch between "ALL locations" and specific location views
// =============================================================================

export const SetLocationContextSchema: ToolSchema = {
  name: 'SetLocationContext',
  description: `Switch Wilson's location context between store-wide view and specific location.

**Default: "ALL" (Store-Wide View)**
- Recommended for AI agents
- Full visibility across all locations
- Required for cross-location operations (transfers, reports)

**Specific Location**
- Focus on one location only
- Useful for location-specific tasks
- Filters inventory/products to that location

Use "ALL" to give Wilson maximum visibility and decision-making capability.`,
  parameters: {
    type: 'object',
    properties: {
      location_id: {
        type: 'string',
        description: 'Location ID to switch to, or "ALL" for store-wide view (recommended)'
      }
    },
    required: ['location_id']
  }
};

export const setLocationContextTool: Tool = {
  schema: SetLocationContextSchema,

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { location_id } = params as { location_id: string };

    const authPath = join(homedir(), '.wilson', 'auth.json');

    if (!existsSync(authPath)) {
      return {
        success: false,
        error: 'Not authenticated. Run wilson login first.'
      };
    }

    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));

      if (location_id === 'ALL') {
        auth.currentLocation = {
          id: 'ALL',
          name: 'All Locations (Store-Wide)',
          isDefault: true
        };
      } else {
        const location = auth.locations.find((l: any) => l.id === location_id);
        if (!location) {
          return {
            success: false,
            error: `Location ${location_id} not found. Available locations: ${auth.locations.map((l: any) => l.name).join(', ')}`
          };
        }
        auth.currentLocation = location;
      }

      writeFileSync(authPath, JSON.stringify(auth, null, 2));

      const summary = location_id === 'ALL'
        ? '📍 Switched to Store-Wide view (all locations visible)'
        : `📍 Switched to ${auth.currentLocation.name}`;

      return {
        success: true,
        content: summary,
        summary,
        data: {
          currentLocation: auth.currentLocation,
          isStoreWide: location_id === 'ALL',
          availableLocations: auth.locations
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update location context'
      };
    }
  }
};

export const GetLocationContextSchema: ToolSchema = {
  name: 'GetLocationContext',
  description: `Get Wilson's current location context.

Shows:
- Current location (or "ALL" for store-wide)
- All available locations
- Whether in store-wide view mode`,
  parameters: {
    type: 'object',
    properties: {}
  }
};

export const getLocationContextTool: Tool = {
  schema: GetLocationContextSchema,

  async execute(): Promise<ToolResult> {
    const authPath = join(homedir(), '.wilson', 'auth.json');

    if (!existsSync(authPath)) {
      return {
        success: false,
        error: 'Not authenticated. Run wilson login first.'
      };
    }

    try {
      const auth = JSON.parse(readFileSync(authPath, 'utf-8'));

      const isStoreWide = auth.currentLocation?.id === 'ALL';
      const currentName = auth.currentLocation?.name || 'Not set';

      const summary = isStoreWide
        ? '📍 Current Context: Store-Wide (all locations visible)'
        : `📍 Current Context: ${currentName}`;

      const locationList = auth.locations
        .map((l: any) => `  ${l.id === auth.currentLocation?.id ? '●' : '○'} ${l.name}`)
        .join('\n');

      return {
        success: true,
        content: `${summary}\n\nAvailable Locations:\n${locationList}`,
        summary,
        data: {
          currentLocation: auth.currentLocation,
          isStoreWide,
          availableLocations: auth.locations,
          storeId: auth.storeId,
          storeName: auth.storeName
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get location context'
      };
    }
  }
};

// =============================================================================
// Helper: Load Location Context
// =============================================================================

export function loadLocationContext(): {
  locationId: string | null;
  isStoreWide: boolean;
  locationName: string;
} {
  try {
    const authPath = join(homedir(), '.wilson', 'auth.json');
    if (!existsSync(authPath)) {
      return { locationId: null, isStoreWide: true, locationName: 'ALL' };
    }

    const auth = JSON.parse(readFileSync(authPath, 'utf-8'));
    const isStoreWide = !auth.currentLocation || auth.currentLocation.id === 'ALL';

    return {
      locationId: isStoreWide ? null : auth.currentLocation.id,
      isStoreWide,
      locationName: auth.currentLocation?.name || 'ALL'
    };
  } catch {
    // Default to store-wide on error
    return { locationId: null, isStoreWide: true, locationName: 'ALL' };
  }
}

// =============================================================================
// Export for Tool Registry
// =============================================================================

export const locationContextTools: Record<string, Tool> = {
  SetLocationContext: setLocationContextTool,
  GetLocationContext: getLocationContextTool
};

export const locationContextSchemas: ToolSchema[] = [
  SetLocationContextSchema,
  GetLocationContextSchema
];
