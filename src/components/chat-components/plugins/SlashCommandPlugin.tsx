import React, { useCallback, useMemo, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getSelection, $isRangeSelection, TextNode } from "lexical";
import fuzzysort from "fuzzysort";

import { useCustomCommands } from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { sortSlashCommands } from "@/commands/customCommandUtils";
import { TypeaheadMenuPortal } from "@/components/chat-components/TypeaheadMenuPortal";
import { TypeaheadOption } from "@/components/chat-components/TypeaheadMenuContent";
import {
  useTypeaheadPlugin,
  TypeaheadState,
} from "@/components/chat-components/hooks/useTypeaheadPlugin";
import { composeSlashMenuItems, type SlashMenuItem } from "./slashMenuItems";

interface SlashCommandOption extends TypeaheadOption {
  item: SlashMenuItem;
}

export function SlashCommandPlugin(): JSX.Element {
  const [editor] = useLexicalComposerContext();
  const commands = useCustomCommands();
  const [currentQuery, setCurrentQuery] = useState("");

  const sortedCommands = useMemo(() => sortSlashCommands(commands), [commands]);

  const allOptions = useMemo<SlashCommandOption[]>(() => {
    return composeSlashMenuItems(sortedCommands).map((item) => ({
      key: item.key,
      title: item.name,
      subtitle: item.description || undefined,
      content: item.body,
      item,
    }));
  }, [sortedCommands]);

  const filteredOptions = useMemo(() => {
    if (!currentQuery) return allOptions;
    const titleResults = fuzzysort.go(currentQuery, allOptions, {
      key: "title",
      threshold: -10000,
    });
    if (titleResults.length > 0) {
      return titleResults.map((result) => result.obj);
    }
    const contentResults = fuzzysort.go(currentQuery, allOptions, {
      key: "content",
      threshold: -10000,
    });
    return contentResults.map((result) => result.obj);
  }, [allOptions, currentQuery]);

  const replaceSlashWithName = useCallback(
    (name: string) => {
      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();
        if (!(anchorNode instanceof TextNode)) return;
        const textContent = anchorNode.getTextContent();
        const slashIndex = textContent.lastIndexOf("/", anchor.offset);
        if (slashIndex === -1) return;
        const before = textContent.slice(0, slashIndex);
        const after = textContent.slice(anchor.offset);
        const insert = `/${name} `;
        anchorNode.setTextContent(before + insert + after);
        const newOffset = before.length + insert.length;
        anchorNode.select(newOffset, newOffset);
      });
    },
    [editor]
  );

  const handleSelect = useCallback(
    (option: SlashCommandOption) => {
      const item = option.item;
      void CustomCommandManager.getInstance().recordUsage(item.command);
      replaceSlashWithName(item.name);
    },
    [replaceSlashWithName]
  );

  const { state, handleHighlight } = useTypeaheadPlugin({
    triggerConfig: {
      char: "/",
      allowWhitespace: false,
    },
    options: filteredOptions,
    onSelect: handleSelect,
    onStateChange: (newState: TypeaheadState) => {
      setCurrentQuery(newState.query);
    },
  });

  if (!state.isOpen) return <></>;

  return (
    <TypeaheadMenuPortal
      options={filteredOptions}
      selectedIndex={state.selectedIndex}
      onSelect={handleSelect}
      onHighlight={handleHighlight}
      range={state.range}
      query={state.query}
      showPreview={true}
    />
  );
}
