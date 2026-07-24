import Card from "@/components/ui/Card";
import ConfirmModal from "@/components/ui/ConfirmModal";
import StatusBadge from "@/components/ui/StatusBadge";
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
      <Card active={isSavedDraft} style={isDeleting && styles.cardDeleting}>
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
              <StatusBadge status={item.status} />
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
      </Card>
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

      <ConfirmModal
        visible={!!pendingDeleteItem}
        title="Delete Session"
        body={
          <Text style={styles.modalBody}>
            Delete{" "}
            <Text style={{ fontWeight: "600" }}>
              {pendingDeleteItem?.session_name ||
                pendingDeleteItem?.customer_name ||
                "this session"}
            </Text>
            ? This cannot be undone.
          </Text>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteItem(null)}
      />
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
  cardDeleting: { opacity: 0.5 },
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
  modalBody: { fontSize: FontSize.callout, color: Colors.text.secondary, lineHeight: 22 },
});
