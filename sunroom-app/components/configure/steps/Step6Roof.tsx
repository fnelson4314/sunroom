import LineItemRow from "@/components/configure/LineItemRow";
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
};

// Step 6 is hidden entirely for under_existing (no new roof to configure).
export default function Step6Roof({ configure, allOptions }: Props) {
  const baseRoofTypes = allOptions.filter((o) => {
    if (o.category !== "roof_type" || o.sort_order > 8) return false;
    const roofStyle = configure.state.roofStyle;
    if (!roofStyle || roofStyle === "under_existing") return true;
    if (roofStyle === "roof_only") {
      // Filter by the chosen sub-style (gable or studio)
      const sub = configure.state.roofOnlySubStyle;
      if (!sub) return true; // none picked yet — show all
      return o.name.toLowerCase().includes(sub);
    }
    return o.name.toLowerCase().includes(roofStyle);
  });
  const roofAddOnOptions = allOptions.filter(
    (o) => o.category === "roof_type" && o.sort_order > 8,
  );

  const roofTotal = configure.getRoofCost();

  return (
    <View style={stepStyles.stepContent}>
      <View style={stepStyles.stepTitleRow}>
        <Text style={stepStyles.stepTitle}>Roof Configuration</Text>
        {roofTotal > 0 && (
          <Text style={stepStyles.stepSubtotal}>${roofTotal.toLocaleString()}</Text>
        )}
      </View>

      <FieldLabel label="Roof Type" />
      <OptionGrid>
        {baseRoofTypes.map((option) => (
          <OptionChip
            key={option.id}
            label={option.name}
            description={`$${option.unit_price}/sq ft`}
            selected={configure.state.roofType?.id === option.id}
            onPress={() => configure.setRoofType(option)}
          />
        ))}
      </OptionGrid>

      <FieldLabel label="Roof Add-Ons" />
      {roofAddOnOptions.map((option) => (
        <LineItemRow
          key={option.id}
          name={option.name}
          unitPrice={option.unit_price}
          unitType={option.unit_type}
          isChecked={configure.state.roofAddOns[option.id] !== undefined}
          quantity={configure.state.roofAddOns[option.id] || ""}
          onToggle={() => configure.toggleRoofAddOn(option.id)}
          onQuantityChange={(val) => configure.setRoofAddOnQuantity(option.id, val)}
        />
      ))}
    </View>
  );
}
