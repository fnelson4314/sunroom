import { Colors } from "@/constants/Colors";
import { FontSize } from "@/constants/Typography";
import { deleteSession, getSessionsBySalesperson } from "@/services/api";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const SALESPERSON_ID = "dev-salesperson-1";

type Session = {
  id: string;
  customer_name: string | null;
  session_name: string | null;
  total_price: number | null;
  status: string;
  width_ft: number | null;
  depth_ft: number | null;
  created_at: string;
  render_url: string | null;
};

const statusColors: Record<string, string> = {
  complete: Colors.status.complete,
  failed: Colors.status.failed,
  generating: Colors.status.generating,
  queued: Colors.status.generating,
  draft: Colors.status.draft,
  saved_draft: Colors.primary,
};

const statusLabels: Record<string, string> = {
  complete: "Complete",
  failed: "Failed",
  generating: "Generating",
  queued: "Queued",
  draft: "Draft",
  saved_draft: "Saved Draft",
};

export default function HomeScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDeleteItem, setPendingDeleteItem] = useState<Session | null>(
    null,
  );

  const fetchSessions = async () => {
    try {
      setError(null);
      const data = await getSessionsBySalesperson(SALESPERSON_ID);
      setSessions(data);
    } catch (e) {
      setError("Could not load sessions. Is the backend running?");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchSessions();
  };

  const handleDelete = (item: Session) => setPendingDeleteItem(item);

  const confirmDelete = async () => {
    if (!pendingDeleteItem) return;
    const sessionId = pendingDeleteItem.id;
    setPendingDeleteItem(null);
    setDeletingId(sessionId);
    try {
      await deleteSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (e: any) {
      console.error("Delete failed:", e);
      alert(`Could not delete session: ${e?.message ?? "Unknown error"}`);
    } finally {
      setDeletingId(null);
    }
  };

  const handleContinueDraft = (item: Session) => {
    // Navigate back to configure, passing the draftId so it can reload state
    router.push({
      pathname: "/configure",
      params: {
        photoUri: "",
        box_x1: "0",
        box_y1: "0",
        box_x2: "1",
        box_y2: "1",
        draftId: item.id,
      },
    });
  };

  const renderSession = ({ item }: { item: Session }) => {
    const isDeleting = deletingId === item.id;
    const isSavedDraft = item.status === "saved_draft";
    const displayName = isSavedDraft
      ? item.session_name || "Untitled Draft"
      : item.customer_name || "Unnamed Customer";

    return (
      <View
        style={[
          styles.card,
          isDeleting && styles.cardDeleting,
          isSavedDraft && styles.cardDraft,
        ]}
      >
        <Pressable
          onPress={() => {
            if (isDeleting) return;
            if (isSavedDraft) {
              handleContinueDraft(item);
            } else {
              router.push({
                pathname: "/session/[id]",
                params: { id: item.id },
              });
            }
          }}
        >
          <View style={styles.cardTop}>
            <View style={styles.cardLeft}>
              <Text style={styles.customerName}>{displayName}</Text>
              {/* Coerce to real booleans: a bare `item.customer_name && …` leaks
                  the empty string "" (and `width_ft && …` leaks 0) as a text-node
                  child of this View, which RN rejects — on web it spams
                  "text node cannot be a child of a <View>" and on native it throws. */}
              {!!item.customer_name && !isSavedDraft && (
                <Text style={styles.productName}>{item.customer_name}</Text>
              )}
              {!!item.width_ft && !!item.depth_ft && (
                <Text style={styles.dimensions}>
                  {item.width_ft} × {item.depth_ft} ft
                </Text>
              )}
            </View>
            <View style={styles.cardRight}>
              <View
                style={[
                  styles.statusBadge,
                  {
                    backgroundColor:
                      (statusColors[item.status] ?? Colors.text.tertiary) +
                      "20",
                  },
                ]}
              >
                <Text
                  style={[
                    styles.statusText,
                    {
                      color: statusColors[item.status] ?? Colors.text.tertiary,
                    },
                  ]}
                >
                  {statusLabels[item.status] ?? item.status}
                </Text>
              </View>
              {item.total_price ? (
                <Text style={styles.price}>
                  ${item.total_price.toLocaleString()}
                </Text>
              ) : null}
            </View>
          </View>
        </Pressable>

        <View style={styles.cardBottom}>
          <Text style={styles.date}>
            {new Date(item.created_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </Text>
          <View style={styles.cardActions}>
            {isSavedDraft && (
              <TouchableOpacity
                style={styles.continueButton}
                onPress={() => handleContinueDraft(item)}
                activeOpacity={0.7}
              >
                <Text style={styles.continueButtonText}>Continue →</Text>
              </TouchableOpacity>
            )}
            {isDeleting ? (
              <ActivityIndicator size="small" color={Colors.status.failed} />
            ) : (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(item)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                activeOpacity={0.6}
              >
                <Text style={styles.deleteButtonText}>Delete</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyTitle}>No designs yet</Text>
      <Text style={styles.emptySubtitle}>
        Tap the button below to start your first customer design
      </Text>
    </View>
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
        <Pressable style={styles.retryButton} onPress={fetchSessions}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={sessions}
        keyExtractor={(item) => item.id}
        renderItem={renderSession}
        ListEmptyComponent={renderEmpty}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      />
      <View style={styles.footer}>
        <Pressable
          style={styles.newButton}
          onPress={() => router.push("/camera")}
        >
          <Text style={styles.newButtonText}>+ New Design</Text>
        </Pressable>
      </View>

      {/* Delete confirmation modal */}
      {pendingDeleteItem && (
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Session</Text>
            <Text style={styles.modalBody}>
              Delete{" "}
              <Text style={{ fontWeight: "600" }}>
                {pendingDeleteItem.session_name ||
                  pendingDeleteItem.customer_name ||
                  "this session"}
              </Text>
              ? This cannot be undone.
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setPendingDeleteItem(null)}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalDelete}
                onPress={confirmDelete}
              >
                <Text style={styles.modalDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background,
    padding: 24,
  },
  list: { padding: 16, gap: 12, flexGrow: 1 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 0.5,
    borderColor: Colors.border,
    gap: 8,
  },
  cardDeleting: { opacity: 0.5 },
  cardDraft: {
    borderColor: Colors.primary,
    borderWidth: 1.5,
  },
  cardTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  cardBottom: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardLeft: { flex: 1, gap: 3 },
  cardRight: { alignItems: "flex-end", gap: 6, minWidth: 80 },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  customerName: { fontSize: FontSize.label, fontWeight: "600", color: Colors.text.primary },
  productName: { fontSize: FontSize.body, color: Colors.text.secondary },
  dimensions: { fontSize: FontSize.body, color: Colors.text.tertiary },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 20 },
  statusText: { fontSize: FontSize.body, fontWeight: "600" },
  price: { fontSize: FontSize.label, fontWeight: "700", color: Colors.status.complete },
  date: { fontSize: FontSize.body, color: Colors.text.tertiary },
  continueButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.primary,
  },
  continueButtonText: { fontSize: FontSize.body, fontWeight: "700", color: "#fff" },
  deleteButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.status.failed + "60",
  },
  deleteButtonText: {
    fontSize: FontSize.body,
    fontWeight: "600",
    color: Colors.status.failed,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 80,
    gap: 8,
  },
  emptyTitle: { fontSize: FontSize.heading, fontWeight: "600", color: Colors.text.primary },
  emptySubtitle: {
    fontSize: FontSize.callout,
    color: Colors.text.secondary,
    textAlign: "center",
    maxWidth: 260,
    lineHeight: 22,
  },
  footer: {
    padding: 16,
    paddingBottom: 24,
    backgroundColor: Colors.surface,
    borderTopWidth: 0.5,
    borderTopColor: Colors.border,
  },
  newButton: {
    backgroundColor: Colors.primary,
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  newButtonText: { color: Colors.white, fontSize: FontSize.label, fontWeight: "600" },
  errorText: {
    fontSize: FontSize.label,
    color: Colors.status.failed,
    textAlign: "center",
    marginBottom: 16,
  },
  retryButton: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: { color: Colors.white, fontSize: FontSize.label, fontWeight: "600" },
  modalOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 24,
    width: 320,
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  modalTitle: { fontSize: FontSize.subhead, fontWeight: "700", color: Colors.text.primary },
  modalBody: { fontSize: FontSize.callout, color: Colors.text.secondary, lineHeight: 22 },
  modalButtons: { flexDirection: "row", gap: 10, marginTop: 8 },
  modalCancel: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.background,
    borderWidth: 0.5,
    borderColor: Colors.border,
  },
  modalCancelText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.text.primary,
  },
  modalDelete: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: "center",
    backgroundColor: Colors.status.failed + "15",
    borderWidth: 1,
    borderColor: Colors.status.failed + "40",
  },
  modalDeleteText: {
    fontSize: FontSize.label,
    fontWeight: "600",
    color: Colors.status.failed,
  },
});
