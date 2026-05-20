import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { EnrolledFaceEntry } from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";

type Props = {
  data: EnrolledFaceEntry[];
  onRemove: (name: string) => void;
};

const formatDate = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function EnrolledList({ data, onRemove }: Props) {
  const confirmRemove = (name: string) => {
    Alert.alert("Remove", `Remove "${name}" from enrolled faces?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onRemove(name) },
    ]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Enrolled People</Text>
        <Text style={styles.count}>{data.length}</Text>
      </View>
      <FlatList
        data={data}
        keyExtractor={(item) => item.name}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <Text style={styles.empty}>No one enrolled yet.</Text>
        }
        renderItem={({ item }) => (
          <View style={styles.item}>
            <View style={styles.avatar}>
              <Text style={styles.initial}>{item.name[0].toUpperCase()}</Text>
            </View>
            <View style={styles.info}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={styles.date}>
                {formatDate(item.enrolledAt)}
                {" · "}
                <Text style={styles.angles}>
                  {item.embeddingCount} angle
                  {item.embeddingCount !== 1 ? "s" : ""}
                </Text>
              </Text>
            </View>
            <Pressable
              style={styles.removeBtn}
              onPress={() => confirmRemove(item.name)}
            >
              <Text style={styles.removeBtnText}>✕</Text>
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    marginTop: 16,
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  title: { color: "#fff", fontSize: 16, fontWeight: "700" },
  count: {
    color: "#555",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "#1e1e1e",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  listContent: { gap: 8, paddingBottom: 40 },
  empty: { color: "#444", fontSize: 14, textAlign: "center", marginTop: 24 },

  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  initial: { color: "#fff", fontSize: 18, fontWeight: "700" },
  info: { flex: 1 },
  name: { color: "#fff", fontSize: 15, fontWeight: "600" },
  date: { color: "#555", fontSize: 12, marginTop: 2 },
  angles: { color: "#4ade80", fontSize: 12 },
  removeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#2a1a1a",
    alignItems: "center",
    justifyContent: "center",
  },
  removeBtnText: { color: "#ff6b6b", fontSize: 13, fontWeight: "700" },
});
