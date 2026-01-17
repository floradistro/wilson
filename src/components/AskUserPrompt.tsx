import { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface AskUserPromptProps {
  question: string;
  options?: string[];
  onAnswer: (answer: string) => void;
}

export function AskUserPrompt({ question, options, onAnswer }: AskUserPromptProps) {
  const [input, setInput] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((char, key) => {
    if (key.return) {
      // Submit answer
      if (options && options.length > 0 && !input) {
        onAnswer(options[selectedIndex]);
      } else {
        onAnswer(input || (options ? options[selectedIndex] : ''));
      }
      return;
    }

    if (key.upArrow && options) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : options.length - 1));
      return;
    }

    if (key.downArrow && options) {
      setSelectedIndex((prev) => (prev < options.length - 1 ? prev + 1 : 0));
      return;
    }

    if (key.backspace || key.delete) {
      setInput((prev) => prev.slice(0, -1));
      return;
    }

    // Add character
    if (char && !key.ctrl && !key.meta) {
      setInput((prev) => prev + char);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="green">?</Text>
        <Text bold color="white"> {question}</Text>
      </Box>

      {options && options.length > 0 && (
        <Box flexDirection="column" marginTop={1} marginLeft={2}>
          {options.map((opt, i) => (
            <Box key={i}>
              <Text color={i === selectedIndex ? 'blue' : 'gray'}>
                {i === selectedIndex ? '>' : ' '}
              </Text>
              <Text color={i === selectedIndex ? 'white' : 'gray'}> {opt}</Text>
            </Box>
          ))}
          <Box marginTop={1}>
            <Text dimColor>Use arrows to select, Enter to confirm, or type custom answer</Text>
          </Box>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">{'>'}</Text>
        <Text> {input}</Text>
        <Text color="green">|</Text>
      </Box>
    </Box>
  );
}
