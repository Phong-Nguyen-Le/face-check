import { useActionSheet } from "@expo/react-native-action-sheet";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { EnrolledFaceEntry } from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import ExpoFaceRecognitionModule from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import { CameraType } from "expo-image-picker";

type EnrollState = "idle" | "loading" | "success" | "error";

export default function HomeScreen() {
  const { showActionSheetWithOptions } = useActionSheet();
  const [image, setImage] = useState<string | null>(null);
  const [enrollState, setEnrollState] = useState<EnrollState>("idle");
  const [lastEnrolled, setLastEnrolled] = useState<string | null>(null);
  const [enrolledList, setEnrolledList] = useState<EnrolledFaceEntry[]>([]);

  const refreshList = useCallback(() => {
    const list = ExpoFaceRecognitionModule.listEnrolledFaces();
    setEnrolledList([...list].sort((a, b) => b.enrolledAt - a.enrolledAt));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const pickImage = () => {
    const options = ["Take Photo", "Choose from Library", "Cancel"];
    showActionSheetWithOptions(
      { options, cancelButtonIndex: 2, title: "Select Image" },
      async (selectedIndex) => {
        let result: ImagePicker.ImagePickerResult | null = null;
        if (selectedIndex === 0) {
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.9,
            cameraType: CameraType.front,
          });
        } else if (selectedIndex === 1) {
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ["images"],
            allowsEditing: true,
            aspect: [1, 1],
            quality: 0.9,
          });
        }
        if (result && !result.canceled) {
          const uri = result.assets[0].uri;
          setImage(uri);
          setEnrollState("idle");
          setLastEnrolled(null);
          promptForName(uri);
        }
      },
    );
  };

  const promptForName = (uri: string) => {
    Alert.prompt(
      "Enter Name",
      "Who is this person?",
      async (name) => {
        if (!name?.trim()) return;
        await enroll(uri, name.trim());
      },
      "plain-text",
      "",
      "default",
    );
  };

  const enroll = async (uri: string, name: string) => {
    setEnrollState("loading");
    try {
      const result = await ExpoFaceRecognitionModule.enrollFaceAsync(uri, name);
      if (result.success) {
        setLastEnrolled(name);
        setEnrollState("success");
        refreshList();
      } else {
        setEnrollState("error");
        Alert.alert("No face detected", "Make sure a face is clearly visible.");
      }
    } catch (e: any) {
      setEnrollState("error");
      Alert.alert("Error", e?.message ?? "Enrollment failed.");
    }
  };

  const confirmRemove = (name: string) => {
    Alert.alert("Remove", `Remove "${name}" from enrolled faces?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          ExpoFaceRecognitionModule.removeEnrolledFace(name);
          refreshList();
        },
      },
    ]);
  };

  const formatDate = (ts: number) => {
    const d = new Date(ts * 1000);
    return d.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  return (
    <View style={styles.root}>
      {/* ── Top: enroll section ── */}
      <View style={styles.enrollSection}>
        <Text style={styles.title}>Enroll Face</Text>

        <Pressable style={styles.imageArea} onPress={pickImage}>
          {image ? (
            <Image
              source={{ uri: image }}
              style={styles.image}
              contentFit="cover"
            />
          ) : (
            <View style={styles.placeholder}>
              <Text style={styles.placeholderIcon}>📷</Text>
              <Text style={styles.placeholderText}>Tap to select image</Text>
            </View>
          )}
          {enrollState === "loading" && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color="#fff" size="large" />
              <Text style={styles.loadingText}>Enrolling…</Text>
            </View>
          )}
        </Pressable>

        {enrollState === "success" && lastEnrolled && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>✓ {lastEnrolled} enrolled</Text>
          </View>
        )}
        {enrollState === "error" && (
          <View style={[styles.badge, styles.badgeError]}>
            <Text style={[styles.badgeText, styles.badgeTextError]}>
              ✗ No face detected
            </Text>
          </View>
        )}

        {image && enrollState !== "loading" && (
          <View style={styles.actions}>
            <Pressable style={styles.btnPrimary} onPress={pickImage}>
              <Text style={styles.btnPrimaryText}>
                {enrollState === "success" ? "Enroll Another" : "Change Image"}
              </Text>
            </Pressable>
            {enrollState === "success" && image && (
              <Pressable
                style={styles.btnGhost}
                onPress={() => promptForName(image)}
              >
                <Text style={styles.btnGhostText}>Re-enroll</Text>
              </Pressable>
            )}
          </View>
        )}
      </View>

      {/* ── Bottom: enrolled list ── */}
      <View style={styles.listSection}>
        <View style={styles.listHeader}>
          <Text style={styles.listTitle}>Enrolled People</Text>
          <Text style={styles.listCount}>{enrolledList.length}</Text>
        </View>

        <FlatList
          data={enrolledList}
          keyExtractor={(item) => item.name}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={styles.listEmpty}>No one enrolled yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.listItem}>
              <View style={styles.listItemAvatar}>
                <Text style={styles.listItemInitial}>
                  {item.name[0].toUpperCase()}
                </Text>
              </View>
              <View style={styles.listItemInfo}>
                <Text style={styles.listItemName}>{item.name}</Text>
                <Text style={styles.listItemDate}>
                  {formatDate(item.enrolledAt)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0a0a0a",
  },

  // Enroll section
  enrollSection: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 16,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  imageArea: {
    width: 220,
    height: 220,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 2,
    borderColor: "#333",
    borderStyle: "dashed",
  },
  image: { width: "100%", height: "100%" },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "#1a1a1a",
  },
  placeholderIcon: { fontSize: 40 },
  placeholderText: { color: "#666", fontSize: 14, fontWeight: "500" },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.65)",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  badge: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: "#1a2e1a",
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#4ade80",
  },
  badgeError: { backgroundColor: "#2e1a1a", borderColor: "#ff6b6b" },
  badgeText: { color: "#4ade80", fontSize: 13, fontWeight: "600" },
  badgeTextError: { color: "#ff6b6b" },
  actions: { flexDirection: "row", gap: 10 },
  btnPrimary: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    backgroundColor: "#fff",
    borderRadius: 50,
  },
  btnPrimaryText: { color: "#000", fontWeight: "600", fontSize: 14 },
  btnGhost: {
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#444",
  },
  btnGhostText: { color: "#888", fontWeight: "600", fontSize: 14 },

  // List section
  listSection: {
    flex: 1,
    marginTop: 20,
    backgroundColor: "#111",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 20,
  },
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  listTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
  listCount: {
    color: "#555",
    fontSize: 13,
    fontWeight: "600",
    backgroundColor: "#1e1e1e",
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  listContent: { gap: 8, paddingBottom: 40 },
  listEmpty: {
    color: "#444",
    fontSize: 14,
    textAlign: "center",
    marginTop: 24,
  },
  listItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    padding: 12,
  },
  listItemAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#333",
  },
  listItemInitial: { color: "#fff", fontSize: 18, fontWeight: "700" },
  listItemInfo: { flex: 1 },
  listItemName: { color: "#fff", fontSize: 15, fontWeight: "600" },
  listItemDate: { color: "#555", fontSize: 12, marginTop: 2 },
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
