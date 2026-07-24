import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { FLOW_STEPS, useDesignSession } from "@/contexts/DesignSession";
import { router } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

// Header dropdown for jumping between the flow screens. Any step the user has
// already reached (index <= furthestStep) stays selectable in EITHER direction
// — once you've generated and seen Design/Quote, going back to Configure must
// not lock you out of them again, even with no changes made. Editor/Quote
// additionally require a render to exist. Every target hydrates from the
// draft row (draftId) so nothing is lost. `current` is this screen's index in
// FLOW_STEPS. Regeneration is a separate concern, handled by Configure's own
// Generate button (which reuses the existing render when nothing render-
// affecting changed, or asks to confirm when it did) — this menu never
// silently regenerates or discards a render just because the config moved on.
type Props = {
  current: number;
  // Called (and awaited) before actually navigating away, so in-progress edits
  // on the current screen aren't silently lost when jumping via this menu —
  // e.g. Configure passes its own draft-autosave here. Best-effort: a save
  // failure is not allowed to trap the user on the current screen.
  onBeforeNavigate?: () => Promise<unknown> | void;
};

export default function FlowNav({ current, onBeforeNavigate }: Props) {
  const { furthestStep, draftId, lastRender } = useDesignSession();
  const [open, setOpen] = useState(false);

  const go = async (idx: number) => {
    setOpen(false);
    if (idx === current) return;
    if (onBeforeNavigate) {
      try {
        await onBeforeNavigate();
      } catch (e) {
        console.warn("FlowNav onBeforeNavigate failed:", e);
      }
    }
    const step = FLOW_STEPS[idx];
    // Editor/Quote need a render to show; only reachable if one exists.
    if (
      (step.route === "/editor" || step.route === "/quote") &&
      !lastRender
    ) {
      return;
    }
    if (step.route === "/editor") {
      router.replace({
        pathname: "/editor",
        params: {
          sessionId: lastRender!.sessionId,
          renderUrl: lastRender!.renderUrls[0] ?? "",
          renderUrls: JSON.stringify(lastRender!.renderUrls),
          draftId: draftId ?? "",
        },
      });
      return;
    }
    if (step.route === "/quote") {
      router.replace({
        pathname: "/quote",
        params: {
          sessionId: lastRender!.sessionId,
          renderUrl: lastRender!.renderUrls[0] ?? "",
          draftId: draftId ?? "",
        },
      });
      return;
    }
    // Camera / Configure hydrate the whole design from the draft row.
    router.replace({
      pathname: step.route,
      params: { draftId: draftId ?? "" },
    });
  };

  const currentLabel = FLOW_STEPS[current]?.label ?? "";

  return (
    <>
      <Pressable
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
        onPress={() => setOpen(true)}
        hitSlop={8}
      >
        <Text style={styles.triggerIcon}>☰</Text>
        <Text style={styles.triggerText} numberOfLines={1}>
          {currentLabel}
        </Text>
        <Text style={styles.chevron}>▾</Text>
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <View style={styles.menu}>
            <Text style={styles.menuHeader}>Go to</Text>
            {FLOW_STEPS.map((step, idx) => {
              // furthestStep only ever advances (see reachStep), so once a step
              // has been reached — including Design/Quote, which only mark
              // themselves reached after a real render exists — it stays
              // reachable in both directions for the rest of the session.
              const reached = idx <= furthestStep;
              const needsRender =
                step.route === "/editor" || step.route === "/quote";
              const isCurrent = idx === current;
              const disabled =
                isCurrent ||
                !reached ||
                (needsRender && !lastRender) ||
                // Transient job screens (Generate) are never a jump target —
                // you can only ever be "here," not navigate here.
                ("nonNavigable" in step && step.nonNavigable);
              return (
                <Pressable
                  key={step.route}
                  style={[styles.item, isCurrent && styles.itemCurrent]}
                  disabled={disabled}
                  onPress={() => go(idx)}
                >
                  <View
                    style={[
                      styles.numBadge,
                      isCurrent && styles.numBadgeCurrent,
                      disabled && !isCurrent && styles.numBadgeDisabled,
                    ]}
                  >
                    <Text
                      style={[
                        styles.numText,
                        (isCurrent || !disabled) && styles.numTextActive,
                      ]}
                    >
                      {idx + 1}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.itemText,
                      disabled && !isCurrent && styles.itemTextDisabled,
                      isCurrent && styles.itemTextCurrent,
                    ]}
                  >
                    {step.label}
                  </Text>
                  {isCurrent && <Text style={styles.itemHere}>You're here</Text>}
                  {!reached && <Text style={styles.itemLock}>🔒</Text>}
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: Colors.primary,
    borderRadius: 22,
    paddingLeft: 14,
    paddingRight: 12,
    paddingVertical: 8,
    maxWidth: 260,
    shadowColor: "#000",
    shadowOpacity: 0.15,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  triggerPressed: {
    opacity: 0.85,
  },
  triggerIcon: {
    fontSize: FontSize.callout,
    color: Colors.white,
    fontWeight: "700",
  },
  triggerText: {
    fontSize: FontSize.callout,
    fontWeight: "700",
    color: Colors.white,
  },
  chevron: {
    fontSize: FontSize.small,
    color: Colors.white,
    opacity: 0.9,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    paddingTop: 90,
    alignItems: "center",
  },
  menu: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    paddingVertical: 8,
    minWidth: 280,
    borderWidth: 0.5,
    borderColor: Colors.border,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  menuHeader: {
    fontSize: FontSize.small,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    color: Colors.text.tertiary,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8,
  },
  itemCurrent: {
    backgroundColor: Colors.background,
  },
  itemText: {
    flex: 1,
    fontSize: FontSize.callout,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  itemTextCurrent: {
    color: Colors.primary,
  },
  itemTextDisabled: {
    color: Colors.text.tertiary,
  },
  numBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.primary,
  },
  numBadgeCurrent: {
    backgroundColor: Colors.primary,
  },
  numBadgeDisabled: {
    backgroundColor: Colors.border,
  },
  numText: {
    fontSize: FontSize.body,
    fontWeight: "800",
    color: Colors.text.tertiary,
  },
  numTextActive: {
    color: Colors.white,
  },
  itemHere: {
    fontSize: FontSize.small,
    fontWeight: "700",
    color: Colors.primary,
  },
  itemLock: {
    fontSize: FontSize.small,
    opacity: 0.5,
  },
});
