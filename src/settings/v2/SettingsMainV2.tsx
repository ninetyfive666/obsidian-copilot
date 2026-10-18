import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { Button } from "@/components/ui/button";
import { TabContent, TabItem, type TabItem as TabItemType } from "@/components/ui/setting-tabs";
import { PluginProvider } from "@/contexts/PluginContext";
import { TabProvider, useTab } from "@/contexts/TabContext";
import CopilotPlugin from "@/main";
import { ByokPanel, ModelManagementProvider } from "@/modelManagement";
import { resetSettings } from "@/settings/model";
import { COPILOT_SETTINGS_TAB_IDS, type CopilotSettingsTabId } from "@/settings/settingsTabs";
import { CommandSettings } from "@/settings/v2/components/CommandSettings";
import { Cog, Command, Cpu, Wrench } from "lucide-react";
import React from "react";
import { AdvancedSettings } from "./components/AdvancedSettings";
import { BasicSettings } from "./components/BasicSettings";

const icons: Record<CopilotSettingsTabId, JSX.Element> = {
  basic: <Cog className="tw-size-5" />,
  byok: <Cpu className="tw-size-5" />,
  command: <Command className="tw-size-5" />,
  advanced: <Wrench className="tw-size-5" />,
};

const components: Record<CopilotSettingsTabId, React.FC> = {
  basic: () => <BasicSettings />,
  byok: () => <ByokPanel />,
  command: () => <CommandSettings />,
  advanced: () => <AdvancedSettings />,
};

const TAB_LABELS: Record<CopilotSettingsTabId, string> = {
  basic: "Basic",
  byok: "Models",
  command: "Command",
  advanced: "Advanced",
};

const tabs = COPILOT_SETTINGS_TAB_IDS.map((id) => ({
  id,
  icon: icons[id],
  label: TAB_LABELS[id],
})) satisfies TabItemType[];

const SettingsContent: React.FC = () => {
  const { selectedTab, setSelectedTab } = useTab();

  return (
    <div className="tw-flex tw-flex-col">
      <div className="tw-flex tw-flex-wrap tw-rounded-lg">
        {tabs.map((tab) => (
          <TabItem
            key={tab.id}
            tab={tab}
            isSelected={selectedTab === tab.id}
            onClick={() => setSelectedTab(tab.id)}
          />
        ))}
      </div>
      <div className="tw-w-full tw-border tw-border-solid" />

      <div>
        {COPILOT_SETTINGS_TAB_IDS.map((id) => {
          const Component = components[id];
          return (
            <TabContent key={id} id={id} isSelected={selectedTab === id}>
              <Component />
            </TabContent>
          );
        })}
      </div>
    </div>
  );
};

interface SettingsMainV2Props {
  plugin: CopilotPlugin;
  initialTab?: CopilotSettingsTabId;
}

const SettingsMainV2: React.FC<SettingsMainV2Props> = ({ plugin, initialTab = "basic" }) => {
  const [resetKey, setResetKey] = React.useState(0);

  const handleReset = () => {
    const modal = new ResetSettingsConfirmModal(plugin.app, () => {
      resetSettings();
      setResetKey((prev) => prev + 1);
    });
    modal.open();
  };

  return (
    <PluginProvider plugin={plugin}>
      <ModelManagementProvider api={plugin.modelManagement}>
        <TabProvider initialTab={initialTab}>
          <div className="tw-mx-auto tw-max-w-[860px]">
            <div className="tw-mb-4 tw-flex tw-flex-col tw-gap-2">
              <div
                role="heading"
                aria-level={1}
                className="tw-flex tw-flex-col tw-gap-2 tw-text-base tw-font-semibold sm:tw-flex-row sm:tw-items-center sm:tw-justify-between"
              >
                <div className="tw-flex tw-items-center tw-gap-2">
                  <span>Copilot Settings</span>
                  <div className="tw-flex tw-items-center tw-gap-1">
                    <span className="tw-text-xs tw-font-normal tw-text-muted">
                      v{plugin.manifest.version}
                    </span>
                  </div>
                </div>
                <div className="tw-self-end sm:tw-self-auto">
                  <Button variant="secondary" size="sm" onClick={handleReset}>
                    Reset Settings
                  </Button>
                </div>
              </div>
            </div>
            <SettingsContent key={resetKey} />
          </div>
        </TabProvider>
      </ModelManagementProvider>
    </PluginProvider>
  );
};

export default SettingsMainV2;
