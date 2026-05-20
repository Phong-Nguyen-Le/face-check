import { useActionSheet } from "@expo/react-native-action-sheet";
import { Image } from "expo-image";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { SLOT_CONFIG } from "@/constants/enroll";
import type { EnrollState, Slot } from "@/types/enroll";

type Props = {
  images: Record<Slot, string | null>;
  name: string;
  enrollState: EnrollState;
  onOpenCamera: () => void;
  onPickLibrary: (slot: Slot) => void;
  onNameChange: (text: string) => void;
  onEnroll: () => void;
  onReset: () => void;
};

export default function EnrollSection({
  images,
  name,
  enrollState,
  onOpenCamera,
  onPickLibrary,
  onNameChange,
  onEnroll,
  onReset,
}: Props) {
  const { showActionSheetWithOptions } = useActionSheet();

  const canEnroll = name.trim().length > 0 && images.front !== null;
  const filledCount = Object.values(images).filter(Boolean).length;

  const pickForSlot = (slot: Slot) => {
    showActionSheetWithOptions(
      {
        options: ["Guided Camera Capture", "Choose from Library", "Cancel"],
        cancelButtonIndex: 2,
      },
      (idx) => {
        if (idx === 0) onOpenCamera();
        else if (idx === 1) onPickLibrary(slot);
      },
    );
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Enroll Face</Text>

      {/* Image slots */}
      <View style={styles.slotsRow}>
        {SLOT_CONFIG.map((slot) => (
          <Pressable
            key={slot.key}
            style={styles.slot}
            onPress={() => pickForSlot(slot.key)}
          >
            {images[slot.key] ? (
              <Image
                source={{ uri: images[slot.key]! }}
                style={styles.slotImage}
                contentFit="cover"
              />
            ) : (
              <View style={styles.slotPlaceholder}>
                <Text style={styles.slotPlus}>+</Text>
              </View>
            )}
            <View style={styles.slotLabelRow}>
              <Text style={styles.slotLabel}>{slot.label}</Text>
              {slot.key === "front" && (
                <Text style={styles.slotRequired}> *</Text>
              )}
            </View>
          </Pressable>
        ))}
      </View>

      {/* Guided capture shortcut */}
      <Pressable style={styles.guidedBtn} onPress={onOpenCamera}>
        <Text style={styles.guidedBtnText}>📷 Guided Camera Capture</Text>
      </Pressable>

      <Text style={styles.hint}>
        {filledCount === 0
          ? "Capture from multiple angles for better accuracy"
          : `${filledCount} / 3 angle${filledCount > 1 ? "s" : ""} ready`}
      </Text>

      {/* Name input */}
      <TextInput
        style={styles.nameInput}
        placeholder="Enter name…"
        placeholderTextColor="#555"
        value={name}
        onChangeText={onNameChange}
        returnKeyType="done"
        autoCapitalize="words"
      />

      {/* Status badge */}
      {enrollState === "success" && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>
            {`✓ ${name.trim()} enrolled (${filledCount} angle${filledCount > 1 ? "s" : ""})`}
          </Text>
        </View>
      )}
      {enrollState === "error" && (
        <View style={[styles.badge, styles.badgeError]}>
          <Text style={[styles.badgeText, styles.badgeTextError]}>
            ✗ No face detected
          </Text>
        </View>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        {enrollState === "success" ? (
          <Pressable style={styles.btnPrimary} onPress={onReset}>
            <Text style={styles.btnPrimaryText}>Enroll Another</Text>
          </Pressable>
        ) : (
          <Pressable
            style={[styles.btnPrimary, !canEnroll && styles.btnDisabled]}
            onPress={onEnroll}
            disabled={!canEnroll || enrollState === "loading"}
          >
            {enrollState === "loading" ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text
                style={[
                  styles.btnPrimaryText,
                  !canEnroll && styles.btnDisabledText,
                ]}
              >
                Enroll
              </Text>
            )}
          </Pressable>
        )}
        {(images.front || images.left || images.right) &&
          enrollState !== "loading" && (
            <Pressable style={styles.btnGhost} onPress={onReset}>
              <Text style={styles.btnGhostText}>Clear</Text>
            </Pressable>
          )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    paddingTop: 60,
    paddingHorizontal: 24,
    gap: 12,
  },
  title: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: 0.4,
    marginBottom: 4,
  },

  slotsRow: { flexDirection: "row", gap: 10, width: "100%" },
  slot: { flex: 1, alignItems: "center", gap: 6 },
  slotImage: { width: "100%", aspectRatio: 1, borderRadius: 12 },
  slotPlaceholder: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#1a1a1a",
    borderWidth: 1.5,
    borderColor: "#333",
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  slotPlus: { color: "#555", fontSize: 28, fontWeight: "300" },
  slotLabelRow: { flexDirection: "row", alignItems: "center" },
  slotLabel: { color: "#888", fontSize: 12, fontWeight: "500" },
  slotRequired: { color: "#4ade80", fontSize: 12, fontWeight: "700" },

  guidedBtn: {
    width: "100%",
    paddingVertical: 13,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    alignItems: "center",
  },
  guidedBtnText: { color: "#fff", fontSize: 14, fontWeight: "600" },

  hint: { color: "#444", fontSize: 12, textAlign: "center" },

  nameInput: {
    width: "100%",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },

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
    paddingHorizontal: 28,
    paddingVertical: 12,
    backgroundColor: "#fff",
    borderRadius: 50,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { backgroundColor: "#2a2a2a" },
  btnPrimaryText: { color: "#000", fontWeight: "700", fontSize: 14 },
  btnDisabledText: { color: "#555" },
  btnGhost: {
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#333",
  },
  btnGhostText: { color: "#666", fontWeight: "600", fontSize: 14 },
});
