import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { COLORS } from '../theme/colors.js';
import { ICONS, SPACING } from '../theme/ui.js';
import { DESIGN_SYSTEM } from '../theme/design-system.js';

interface StatusBarProps {
  user?: {
    email?: string;
    first_name?: string;
  };
  store?: {
    name?: string;
    id?: string;
  };
  location?: {
    name?: string;
    id?: string;
  };
  isOnline?: boolean;
  isStreaming?: boolean;
  usage?: {
    tokens?: number;
    requests?: number;
  };
  terminalWidth?: number;
  showDebugInfo?: boolean;
}

export function EnhancedStatusBar({
  user,
  store,
  location,
  isOnline = true,
  isStreaming = false,
  usage,
  terminalWidth = 80,
  showDebugInfo = false,
}: StatusBarProps) {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [networkStatus, setNetworkStatus] = useState<'online' | 'offline' | 'slow'>('online');

  // Update time every minute
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  // Format time in Apple style
  const timeString = currentTime.toLocaleTimeString('en-US', { 
    hour: 'numeric',
    minute: '2-digit',
    hour12: true 
  });

  // Calculate available space for adaptive layout
  const isNarrow = terminalWidth < 100;
  const isWide = terminalWidth >= 140;

  // Status indicator with color
  const getStatusColor = () => {
    if (!isOnline) return COLORS.error;
    if (isStreaming) return COLORS.warning;
    return COLORS.success;
  };

  const getStatusIcon = () => {
    if (!isOnline) return ICONS.error;
    if (isStreaming) return ICONS.running;
    return ICONS.success;
  };

  const getStatusText = () => {
    if (!isOnline) return 'Offline';
    if (isStreaming) return 'Processing';
    return 'Ready';
  };

  // Create status sections
  const StatusSection = ({ label, value, icon, color = COLORS.textMuted }: {
    label?: string;
    value: string;
    icon?: string;
    color?: string;
  }) => (
    <Box marginRight={isNarrow ? 2 : 3}>
      {icon && (
        <Text color={color} marginRight={1}>
          {icon}
        </Text>
      )}
      {label && !isNarrow && (
        <Text color={COLORS.textDim} marginRight={1}>
          {label}:
        </Text>
      )}
      <Text color={color}>
        {value}
      </Text>
    </Box>
  );

  return (
    <Box
      borderStyle="round"
      borderColor={DESIGN_SYSTEM.semantic.border.subtle}
      paddingX={2}
      paddingY={0}
      marginY={1}
    >
      <Box justifyContent="space-between" width="100%">
        {/* Left side - User and context info */}
        <Box>
          {/* Status */}
          <StatusSection
            icon={getStatusIcon()}
            value={getStatusText()}
            color={getStatusColor()}
          />

          {/* User info */}
          {user && (
            <StatusSection
              label={!isNarrow ? "User" : undefined}
              icon="👤"
              value={user.first_name || user.email?.split('@')[0] || 'User'}
              color={COLORS.textMuted}
            />
          )}

          {/* Store context */}
          {store && (
            <StatusSection
              label={!isNarrow ? "Store" : undefined}
              icon="🏪"
              value={store.name || 'Store'}
              color={COLORS.textMuted}
            />
          )}

          {/* Location context */}
          {location && !isNarrow && (
            <StatusSection
              label="Location"
              icon="📍"
              value={location.name || 'Location'}
              color={COLORS.textMuted}
            />
          )}
        </Box>

        {/* Right side - System info */}
        <Box>
          {/* Usage stats (wide screens only) */}
          {usage && isWide && (
            <>
              {usage.requests !== undefined && (
                <StatusSection
                  label="Requests"
                  value={usage.requests.toString()}
                  color={COLORS.textMuted}
                />
              )}
              {usage.tokens !== undefined && (
                <StatusSection
                  label="Tokens"
                  value={usage.tokens.toLocaleString()}
                  color={COLORS.textMuted}
                />
              )}
            </>
          )}

          {/* Time */}
          <StatusSection
            icon={ICONS.info}
            value={timeString}
            color={COLORS.textMuted}
          />

          {/* Debug info */}
          {showDebugInfo && (
            <StatusSection
              label="Width"
              value={terminalWidth.toString()}
              color={COLORS.textVeryDim}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

/**
 * Minimal status bar for compact layouts
 */
export function CompactStatusBar({ isOnline, isStreaming }: {
  isOnline?: boolean;
  isStreaming?: boolean;
}) {
  const getStatusColor = () => {
    if (!isOnline) return COLORS.error;
    if (isStreaming) return COLORS.warning;
    return COLORS.success;
  };

  const getStatusIcon = () => {
    if (!isOnline) return ICONS.error;
    if (isStreaming) return ICONS.running;
    return ICONS.success;
  };

  return (
    <Box>
      <Text color={getStatusColor()}>
        {getStatusIcon()} Wilson
      </Text>
    </Box>
  );
}