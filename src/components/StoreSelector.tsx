import { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { StoreInfo, LocationInfo } from '../types.js';

interface StoreSelectorProps {
  mode: 'store' | 'location';
  stores: StoreInfo[];
  locations: LocationInfo[];
  currentStoreId: string | null;
  currentLocationId: string | null;
  onSelectStore: (storeId: string) => void;
  onSelectLocation: (locationId: string | null) => void;
  onCancel: () => void;
}

export function StoreSelector({
  mode,
  stores,
  locations,
  currentStoreId,
  currentLocationId,
  onSelectStore,
  onSelectLocation,
  onCancel,
}: StoreSelectorProps) {
  const items = mode === 'store' ? stores : locations;
  const currentId = mode === 'store' ? currentStoreId : currentLocationId;

  // Find current index
  const currentIndex = items.findIndex(item =>
    mode === 'store'
      ? (item as StoreInfo).storeId === currentId
      : (item as LocationInfo).id === currentId
  );

  const [selectedIndex, setSelectedIndex] = useState(Math.max(0, currentIndex));

  useInput((char, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    if (key.return) {
      if (mode === 'store' && items.length > 0) {
        const store = items[selectedIndex] as StoreInfo;
        onSelectStore(store.storeId);
      } else if (mode === 'location') {
        if (items.length > 0) {
          const location = items[selectedIndex] as LocationInfo;
          onSelectLocation(location.id);
        } else {
          onSelectLocation(null);
        }
      }
      return;
    }

    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
      return;
    }

    // Number keys for quick selection (1-9)
    const num = parseInt(char, 10);
    if (!isNaN(num) && num >= 1 && num <= items.length) {
      setSelectedIndex(num - 1);
      return;
    }
  });

  // Reset selection when mode changes
  useEffect(() => {
    const idx = items.findIndex(item =>
      mode === 'store'
        ? (item as StoreInfo).storeId === currentId
        : (item as LocationInfo).id === currentId
    );
    setSelectedIndex(Math.max(0, idx));
  }, [mode, items, currentId]);

  const title = mode === 'store' ? 'Select Store' : 'Select Location';
  const emptyMsg = mode === 'store'
    ? 'No stores available'
    : 'No locations for this store';

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="#7DC87D" bold>{title}</Text>
      </Box>

      {items.length === 0 ? (
        <Box marginTop={1} marginLeft={2}>
          <Text dimColor>{emptyMsg}</Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {items.map((item, i) => {
            const isStore = mode === 'store';
            const id = isStore ? (item as StoreInfo).storeId : (item as LocationInfo).id;
            const name = isStore ? (item as StoreInfo).storeName : (item as LocationInfo).name;
            const role = isStore ? (item as StoreInfo).role : null;
            const isDefault = !isStore && (item as LocationInfo).isDefault;
            const isCurrent = id === currentId;
            const isSelected = i === selectedIndex;

            return (
              <Box key={id} paddingLeft={1}>
                <Text color={isSelected ? '#7DC87D' : '#555555'}>
                  {isSelected ? '>' : ' '}
                </Text>
                <Text color="#666666"> {i + 1}. </Text>
                <Text color={isSelected ? 'white' : '#888888'} bold={isSelected}>
                  {name}
                </Text>
                {role && (
                  <Text color="#555555"> ({role})</Text>
                )}
                {isDefault && (
                  <Text color="#555555"> (default)</Text>
                )}
                {isCurrent && (
                  <Text color="#7DC87D"> *</Text>
                )}
              </Box>
            );
          })}
        </Box>
      )}

      <Box marginTop={1} paddingLeft={1}>
        <Text dimColor>↑↓ Navigate • Enter Select • Esc Cancel • 1-9 Quick select</Text>
      </Box>
    </Box>
  );
}
