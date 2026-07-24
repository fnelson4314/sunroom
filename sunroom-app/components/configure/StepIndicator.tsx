import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import StepDots, { StepDotItem } from "@/components/ui/StepDots";
import { StyleSheet, Text, View } from "react-native";

type Props = {
  currentStep: number; // 1-based position within the VISIBLE steps
  totalSteps: number; // count of visible steps (may be < 9 when steps are skipped)
  stepLabels: string[]; // labels for each visible step, length === totalSteps
  onStepPress: (step: number) => void; // 1-based position within visible steps
};

export default function StepIndicator({
  currentStep,
  totalSteps,
  stepLabels,
  onStepPress,
}: Props) {
  const currentLabel = stepLabels[currentStep - 1] ?? "";

  const items: StepDotItem[] = stepLabels.map((label, index) => {
    const stepNumber = index + 1;
    return {
      key: label,
      label,
      state:
        stepNumber < currentStep
          ? "done"
          : stepNumber === currentStep
            ? "current"
            : "future",
    };
  });

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.stepCount}>
          Step {currentStep} of {totalSteps}
        </Text>
        <Text style={styles.stepName}>{currentLabel}</Text>
      </View>

      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${(currentStep / totalSteps) * 100}%` },
          ]}
        />
      </View>

      <StepDots
        items={items}
        variant="light"
        layout="wrap"
        onPress={(index) => onStepPress(index + 1)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface,
    paddingTop: 12,
    paddingBottom: 8,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  stepCount: {
    fontSize: FontSize.small,
    fontWeight: "700",
    color: Colors.text.secondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  stepName: {
    fontSize: FontSize.label,
    fontWeight: "700",
    color: Colors.primary,
  },
  barTrack: {
    height: 4,
    backgroundColor: Colors.border,
    borderRadius: 2,
    overflow: "hidden",
  },
  barFill: {
    height: 4,
    backgroundColor: Colors.primary,
    borderRadius: 2,
  },
});
