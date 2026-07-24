import LineItemRow from "@/components/configure/LineItemRow";
import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import type { Option } from "@/hooks/useConfigureState";
import { StyleSheet, Text, View } from "react-native";
import { stepStyles } from "./stepStyles";
import type { ConfigureApi } from "./types";

const STEP_CATEGORIES: Record<number, string> = {
  2: "demo",
  3: "concrete",
  4: "deck",
  7: "electrical",
  8: "miscellaneous",
};

const STEP_TITLES: Record<number, string> = {
  2: "Demolition",
  3: "Concrete",
  4: "Deck & Deck Options",
  7: "Electrical / HVAC",
  8: "Miscellaneous",
};

type Props = {
  step: number;
  configure: ConfigureApi;
  allOptions: Option[];
};

// Shared by steps 2/3/4/7/8 — each is just "check the items in this catalog
// category and enter quantities," parameterized by which category.
export default function StepLineItems({ step, configure, allOptions }: Props) {
  const category = STEP_CATEGORIES[step];
  const categoryOptions =
    step === 4
      ? allOptions.filter((o) => o.category === "deck" || o.category === "deck_options")
      : allOptions.filter((o) => o.category === category);

  const stepTotal = categoryOptions
    .filter((o) => configure.isLineItemChecked(o.id))
    .reduce((sum, o) => {
      const qty = parseFloat(configure.getLineItemQuantity(o.id)) || 0;
      return sum + o.unit_price * qty;
    }, 0);

  return (
    <View style={stepStyles.stepContent}>
      <View style={stepStyles.stepTitleRow}>
        <Text style={stepStyles.stepTitle}>{STEP_TITLES[step]}</Text>
        {stepTotal > 0 && (
          <Text style={stepStyles.stepSubtotal}>${stepTotal.toLocaleString()}</Text>
        )}
      </View>
      <Text style={styles.hint}>Check all items that apply and enter quantities</Text>
      {categoryOptions.map((option) => (
        <LineItemRow
          key={option.id}
          name={option.name}
          unitPrice={option.unit_price}
          unitType={option.unit_type}
          isChecked={configure.isLineItemChecked(option.id)}
          quantity={configure.getLineItemQuantity(option.id)}
          onToggle={() => configure.toggleLineItem(option.id)}
          onQuantityChange={(val) => configure.setLineItemQuantity(option.id, val)}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: FontSize.small, color: Colors.text.tertiary },
});
