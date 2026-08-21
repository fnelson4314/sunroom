import ScreenRoomBuilder from "@/components/configure/ScreenRoomBuilder";
import WallBuilder, {
  FEATURE_OPTION_KEYWORDS,
  PANEL_TYPES,
} from "@/components/configure/WallBuilder";
import FieldLabel from "@/components/ui/FieldLabel";
import OptionChip from "@/components/ui/OptionChip";
import OptionGrid from "@/components/ui/OptionGrid";
import type { Option } from "@/hooks/useConfigureState";
import { Text, View } from "react-native";
import { stepStyles } from "./stepStyles";
import type { ConfigureApi } from "./types";

type Props = {
  configure: ConfigureApi;
  allOptions: Option[];
  activeWallId: "A" | "B" | "C";
  onActiveWallChange: (id: "A" | "B" | "C") => void;
};

// Step 5 is hidden entirely for roof_only. Branches on wall_system: 2_inch →
// ScreenRoomBuilder, everything else → WallBuilder.
export default function Step5Walls({
  configure,
  allOptions,
  activeWallId,
  onActiveWallChange,
}: Props) {
  const isScreenRoom = configure.state.selectedProductLine?.wall_system === "2_inch";

  const handrailOption =
    allOptions.find((o) => o.name.toLowerCase().includes("screen room aluminum handrails")) ??
    null;
  const extraDoorOption =
    allOptions.find((o) => o.name.toLowerCase().includes("additional screen door")) ?? null;

  // Under-existing reuses the gable/wing config of the existing roof's shape
  // (gable → wall B gable area; studio → A/C wing area), so the user can pick
  // screen/glass/solid and see it. Walls-only (glass rooms can toggle it off)
  // suppresses the gable UI by passing a shape the builders ignore. Applies to
  // BOTH builders — passing the raw "under_existing" to ScreenRoomBuilder was
  // why an under-existing screen room never showed its gable/wing area.
  const builderRoofStyle =
    configure.state.roofStyle === "under_existing"
      ? configure.state.includeGableWings
        ? (configure.state.underExistingShape ?? "gable")
        : "under_existing"
      : configure.state.roofStyle;

  return (
    <View style={stepStyles.stepContent}>
      <Text style={stepStyles.stepTitle}>
        {isScreenRoom ? "Screen Room Configuration" : "Wall Configuration"}
      </Text>

      {/* Under-existing: include a new gable/wing infill, or walls only (keep
          the existing gable). Applies to both wall systems — most
          under-existing screen-room conversions keep an existing gable, so the
          default alone (includeGableWings=true) was wrong for them and there
          was no way to switch it (was hidden here). */}
      {configure.state.roofStyle === "under_existing" && (
        <View style={stepStyles.fieldBlock}>
          <FieldLabel
            label="Gable / Wing Area"
            hint="Is there an existing gable/wing above to keep, or should new gable/wing panes be added up to the roof?"
          />
          <OptionGrid>
            {(
              [
                {
                  value: true,
                  label: "Add Gable / Wings",
                  desc: "New glass or solid infill up to the roof",
                },
                {
                  value: false,
                  label: "Walls Only",
                  desc: "Keep the existing gable above the walls",
                },
              ] as const
            ).map((opt) => (
              <OptionChip
                key={String(opt.value)}
                label={opt.label}
                description={opt.desc}
                selected={configure.state.includeGableWings === opt.value}
                onPress={() => configure.setIncludeGableWings(opt.value, allOptions)}
              />
            ))}
          </OptionGrid>
        </View>
      )}

      {isScreenRoom ? (
        <ScreenRoomBuilder
          screenRoom={configure.state.screenRoom}
          roofStyle={builderRoofStyle}
          mountHeight={configure.state.mountHeight}
          allOptions={allOptions}
          selectedWallType={configure.state.wallType}
          activeWallId={activeWallId}
          onActiveWallChange={onActiveWallChange}
          onWallTypeSelect={(o) => configure.setWallType(o, allOptions)}
          onWallDimensionChange={configure.setScreenWallDimension}
          onUnitWidthChange={configure.setScreenUnitWidth}
          onUnitTypeChange={configure.setScreenUnitType}
          onKneewallChange={configure.setScreenKneewall}
          onKneewallSolidStyle={configure.setScreenKneewallSolidStyle}
          onChairrailChange={configure.setScreenChairrail}
          onHandrailChange={configure.setScreenHandrail}
          onRailWallChange={configure.setScreenRailWall}
          onTransomChange={configure.setScreenTransom}
          onTransomHeightChange={configure.setScreenTransomHeight}
          onGableGlassChange={(wallId, config) =>
            configure.setScreenGableGlass(wallId, config, allOptions)
          }
          wallColor={configure.state.wallColor}
          onWallColorChange={configure.setWallColor}
          handrailOption={handrailOption}
          extraDoorOption={extraDoorOption}
        />
      ) : (
        <WallBuilder
          roofStyle={builderRoofStyle}
          mountHeight={configure.state.mountHeight}
          walls={configure.state.walls}
          wallSystem={configure.state.selectedProductLine?.wall_system ?? null}
          allOptions={allOptions}
          selectedWallType={configure.state.wallType}
          wallAddOns={configure.state.wallAddOns}
          defaultTransomHeightIn={configure.state.defaultTransomHeightIn}
          defaultKneewallHeightIn={configure.state.defaultKneewallHeightIn}
          activeWallId={activeWallId}
          onActiveWallChange={onActiveWallChange}
          onWallTypeSelect={(o) => configure.setWallType(o, allOptions)}
          onDimensionChange={configure.setWallDimension}
          onDefaultTransomHeightChange={configure.setDefaultTransomHeight}
          onDefaultKneewallHeightChange={configure.setDefaultKneewallHeight}
          onUnitTransomHeightChange={configure.setUnitTransomHeight}
          onUnitKneewallHeightChange={configure.setUnitKneewallHeight}
          onWallUnitsChange={configure.setWallUnits}
          onWallPanelTypeChange={(wallId, unitIndex, panelTypeId) =>
            configure.setWallPanelType(
              wallId,
              unitIndex,
              panelTypeId,
              allOptions,
              FEATURE_OPTION_KEYWORDS,
              PANEL_TYPES,
            )
          }
          onUnitMaterialChange={(wallId, unitIndex, feature, material) =>
            configure.setUnitMaterial(wallId, unitIndex, feature, material, allOptions)
          }
          onUnitDoorStyleChange={(wallId, unitIndex, style) =>
            configure.setUnitDoorStyle(wallId, unitIndex, style, allOptions)
          }
          onSplitTransomChange={configure.setSplitTransom}
          onSplitKneewallChange={configure.setSplitKneewall}
          onGableGlassChange={(wallId, config) =>
            configure.setGableGlass(wallId, config, allOptions)
          }
          onWallAddOnToggle={configure.toggleWallAddOn}
          onWallAddOnQuantityChange={configure.setWallAddOnQuantity}
          wallColor={configure.state.wallColor}
          onWallColorChange={configure.setWallColor}
          onSolidMaterialChange={configure.setSolidPanelMaterial}
          transomSolidStyle={configure.state.solidStyles.transom}
          kneewallSolidStyle={configure.state.solidStyles.kneewall}
          wingSolidStyle={configure.state.solidStyles.wing}
          onSolidStyleChange={configure.setSolidStyle}
          onWallUnitWidthChange={configure.setWallUnitWidth}
        />
      )}
    </View>
  );
}
