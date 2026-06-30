import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.dotsRow}
      >
        {stepLabels.map((label, index) => {
          const stepNumber = index + 1;
          const isComplete = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;

          return (
            <View key={label} style={styles.dotWrapper}>
              <TouchableOpacity
                onPress={() => onStepPress(stepNumber)}
                activeOpacity={0.65}
                style={[
                  styles.dot,
                  isComplete && styles.dotComplete,
                  isCurrent && styles.dotCurrent,
                  !isComplete && !isCurrent && styles.dotFuture,
                ]}
              >
                {isComplete ? (
                  <Text style={styles.dotCheck}>✓</Text>
                ) : (
                  <Text
                    style={[
                      styles.dotNumber,
                      isCurrent && styles.dotNumberCurrent,
                    ]}
                  >
                    {stepNumber}
                  </Text>
                )}
              </TouchableOpacity>

              <Text
                style={[
                  styles.dotLabel,
                  isCurrent && styles.dotLabelCurrent,
                  isComplete && styles.dotLabelComplete,
                ]}
              >
                {label}
              </Text>

              {index < stepLabels.length - 1 && (
                <View
                  style={[
                    styles.connector,
                    isComplete && styles.connectorComplete,
                  ]}
                />
              )}
            </View>
          );
        })}
      </ScrollView>
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
  dotsRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 4,
    gap: 0,
  },
  dotWrapper: {
    alignItems: "center",
    position: "relative",
    width: 62,
  },
  dot: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  dotComplete: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dotCurrent: {
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
  },
  dotFuture: {
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  dotCheck: {
    color: Colors.white,
    fontSize: FontSize.label,
    fontWeight: "700",
  },
  dotNumber: {
    fontSize: FontSize.body,
    fontWeight: "700",
    color: Colors.text.secondary,
  },
  dotNumberCurrent: {
    color: Colors.primary,
    fontWeight: "700",
  },
  dotLabel: {
    fontSize: FontSize.caption,
    color: Colors.text.secondary,
    marginTop: 4,
    textAlign: "center",
    fontWeight: "600",
  },
  dotLabelCurrent: {
    color: Colors.primary,
    fontWeight: "700",
  },
  dotLabelComplete: {
    color: Colors.text.secondary,
  },
  connector: {
    position: "absolute",
    top: 15,
    left: "50%",
    width: 62,
    height: 2,
    backgroundColor: Colors.border,
    zIndex: -1,
  },
  connectorComplete: {
    backgroundColor: Colors.primary,
  },
});
