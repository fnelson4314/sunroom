import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

export type StepDotState = "done" | "current" | "future" | "failed";

export type StepDotItem = {
  key: string;
  label?: string;
  state: StepDotState;
};

type Props = {
  items: StepDotItem[];
  // "light": on a white/card surface (the configurator wizard). "done" reads as
  // "visited" (brand blue), matching the rest of the app's selection color.
  // "dark": on a photo/scrim backdrop (the generate job screen). "done" reads
  // as "succeeded" (status green), matching the app's status-badge vocabulary.
  variant?: "light" | "dark";
  // Wizard steps are numbered (closed set, "step 3 of 9" matters); job-progress
  // steps aren't (only state matters) — matches each screen's prior behavior.
  showNumbers?: boolean;
  // "wrap": horizontally-scrollable row with a connector per dot — for lists
  // that may not fit one screen width (the 9-step configurator wizard).
  // "fixed": a non-scrolling row with one background line layer sized for
  // exactly items.length-1 gaps — for a short list that always fits (a job's
  // progress steps).
  layout?: "wrap" | "fixed";
  onPress?: (index: number) => void;
};

export default function StepDots({
  items,
  variant = "light",
  showNumbers = true,
  layout = "wrap",
  onPress,
}: Props) {
  const palette = variant === "dark" ? darkPalette : lightPalette;

  const dotStateStyle = (state: StepDotState) =>
    state === "done"
      ? palette.dotDone
      : state === "current"
        ? palette.dotCurrent
        : state === "failed"
          ? palette.dotFailed
          : palette.dotFuture;

  const renderDot = (item: StepDotItem, index: number) => (
    <View style={[styles.dot, dotStateStyle(item.state)]}>
      {item.state === "done" ? (
        <Text style={[styles.dotText, palette.dotTextOnFill]}>✓</Text>
      ) : item.state === "failed" ? (
        <Text style={[styles.dotText, palette.dotTextOnFill]}>✕</Text>
      ) : showNumbers ? (
        <Text
          style={[
            styles.dotText,
            item.state === "current" ? palette.dotTextCurrent : palette.dotTextFuture,
          ]}
        >
          {index + 1}
        </Text>
      ) : null}
    </View>
  );

  const renderLabel = (item: StepDotItem, extraStyle?: object) =>
    item.label ? (
      <Text
        style={[
          styles.label,
          palette.label,
          item.state !== "future" && palette.labelActive,
          extraStyle,
        ]}
      >
        {item.label}
      </Text>
    ) : null;

  if (layout === "fixed") {
    return (
      <View style={styles.fixedRow}>
        <View style={styles.fixedLines}>
          {items.slice(1).map((_, i) => (
            <View
              key={i}
              style={[
                styles.fixedLine,
                palette.line,
                items[i].state !== "future" && palette.lineDone,
              ]}
            />
          ))}
        </View>
        <View style={styles.fixedDots}>
          {items.map((item, index) => (
            <View key={item.key} style={styles.fixedStep}>
              {renderDot(item, index)}
              {renderLabel(item, styles.fixedLabel)}
            </View>
          ))}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.wrapRow}
    >
      {items.map((item, index) => {
        const Wrapper = onPress ? Pressable : View;
        return (
          <View key={item.key} style={styles.wrapStep}>
            <Wrapper
              {...(onPress ? { onPress: () => onPress(index), activeOpacity: 0.65 } : {})}
            >
              {renderDot(item, index)}
            </Wrapper>
            {renderLabel(item)}
            {index < items.length - 1 && (
              <View
                style={[
                  styles.wrapConnector,
                  palette.line,
                  item.state !== "future" && palette.lineDone,
                ]}
              />
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const lightPalette = {
  dotDone: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  dotCurrent: { borderColor: Colors.primary, backgroundColor: Colors.surface },
  dotFuture: { borderColor: Colors.border, backgroundColor: Colors.surface },
  dotFailed: {
    backgroundColor: Colors.status.failed,
    borderColor: Colors.status.failed,
  },
  dotTextOnFill: { color: Colors.white },
  dotTextCurrent: { color: Colors.primary, fontWeight: "700" as const },
  dotTextFuture: { color: Colors.text.secondary },
  line: { backgroundColor: Colors.border },
  lineDone: { backgroundColor: Colors.primary },
  label: { color: Colors.text.secondary },
  labelActive: { color: Colors.primary, fontWeight: "700" as const },
};

const darkPalette = {
  dotDone: {
    backgroundColor: Colors.status.complete,
    borderColor: Colors.status.complete,
  },
  dotCurrent: {
    borderColor: Colors.white,
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dotFuture: {
    borderColor: "rgba(255,255,255,0.3)",
    backgroundColor: "rgba(255,255,255,0.15)",
  },
  dotFailed: {
    backgroundColor: Colors.status.failed,
    borderColor: Colors.status.failed,
  },
  dotTextOnFill: { color: Colors.white },
  dotTextCurrent: { color: Colors.white, fontWeight: "700" as const },
  dotTextFuture: { color: "rgba(255,255,255,0.6)" },
  line: { backgroundColor: "rgba(255,255,255,0.2)" },
  lineDone: { backgroundColor: Colors.status.complete },
  label: { color: "rgba(255,255,255,0.55)" },
  labelActive: { color: "rgba(255,255,255,0.95)", fontWeight: "600" as const },
};

const styles = StyleSheet.create({
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  dotText: { fontSize: FontSize.body, fontWeight: "700" },
  label: {
    fontSize: FontSize.caption,
    marginTop: 4,
    textAlign: "center",
    fontWeight: "600",
  },
  // Fixed (non-scrolling) layout — a short row that always fits, e.g. a job's
  // progress steps.
  fixedRow: { width: "100%", position: "relative" },
  fixedLines: {
    position: "absolute",
    top: 13,
    left: "10%",
    right: "10%",
    flexDirection: "row",
    justifyContent: "space-between",
    zIndex: 0,
  },
  fixedLine: { flex: 1, height: 2, marginHorizontal: 2 },
  fixedDots: { flexDirection: "row", justifyContent: "space-between", zIndex: 1 },
  fixedStep: { alignItems: "center", flex: 1 },
  fixedLabel: { width: 58 },
  // Wrap (scrollable) layout — a long row that may exceed screen width, e.g.
  // the configurator's 9-step wizard.
  wrapRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 4 },
  wrapStep: { alignItems: "center", position: "relative", width: 62 },
  wrapConnector: {
    position: "absolute",
    top: 15,
    left: "50%",
    width: 62,
    height: 2,
    zIndex: -1,
  },
});
