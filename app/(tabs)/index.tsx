import { useActionSheet } from "@expo/react-native-action-sheet";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import type {
  FaceBox,
  FacesDetectedPayload,
} from "@/modules/expo-face-recognition/src/ExpoFaceRecognition.types";
import type { EnrolledFaceEntry } from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import ExpoFaceRecognitionModule from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import ExpoFaceRecognitionView from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionView";
import Svg, { Rect } from "react-native-svg";

type Slot = "front" | "left" | "right";
type EnrollState = "idle" | "loading" | "success" | "error";
type FaceStatus = "none" | "detecting" | "aligned";

const SLOT_KEYS: Slot[] = ["front", "left", "right"];
const SLOT_CONFIG = [
  { key: "front" as Slot, label: "Front" },
  { key: "left" as Slot, label: "Left" },
  { key: "right" as Slot, label: "Right" },
];

const ENROLL_STEPS = [
  {
    yawMin: -0.15,
    yawMax: 0.15,
    label: "Nhìn thẳng",
    sub: "Nhìn trực tiếp vào camera",
    optional: false,
  },
  {
    yawMin: 0.2,
    yawMax: 0.8,
    label: "Quay nhẹ sang trái",
    sub: "Xoay đầu nhẹ sang bên trái",
    optional: true,
  },
  {
    yawMin: -0.8,
    yawMax: -0.2,
    label: "Quay nhẹ sang phải",
    sub: "Xoay đầu nhẹ sang bên phải",
    optional: true,
  },
];

const HOLD_MS = 1500;

// ── Oval ↔ camera coordinate mapping ──────────────────────────────────────
// Camera buffer: 720 × 1280 (portrait). Preview uses resizeAspect (contain).
const SOURCE_W = 720;
const SOURCE_H = 1280;
const OVAL_W = 220; // must match StyleSheet faceOval width
const OVAL_H = 290; // must match StyleSheet faceOval height

type Layout = { width: number; height: number };

const faceToScreenRect = (
  face: { x: number; y: number; width: number; height: number },
  layout: Layout,
) => {
  const scale = Math.min(layout.width / SOURCE_W, layout.height / SOURCE_H);
  const displayW = SOURCE_W * scale;
  const displayH = SOURCE_H * scale;
  const offsetX = (layout.width - displayW) / 2;
  const offsetY = (layout.height - displayH) / 2;
  return {
    x: offsetX + face.x * displayW,
    y: offsetY + face.y * displayH,
    width: face.width * displayW,
    height: face.height * displayH,
  };
};

const getOvalRect = (layout: Layout) => ({
  x: layout.width / 2 - OVAL_W / 2,
  y: layout.height / 2 - OVAL_H / 2,
  width: OVAL_W,
  height: OVAL_H,
});

// Returns a human-readable reason why the face doesn't fit the oval, or null if it does.
const getFaceIssue = (
  face: { x: number; y: number; width: number; height: number },
  layout: Layout,
): string | null => {
  if (!layout.width || !layout.height) return null;
  const oval = getOvalRect(layout);
  const faceRect = faceToScreenRect(face, layout);

  // Size: face width should be 75–140 % of oval width
  const wRatio = faceRect.width / oval.width;
  if (wRatio < 0.75) return "Move closer to the camera";
  if (wRatio > 1.4) return "Move further from the camera";

  // Center: face center must be within 25 % of oval dimensions from oval center
  const faceCX = faceRect.x + faceRect.width / 2;
  const faceCY = faceRect.y + faceRect.height / 2;
  const ovalCX = oval.x + oval.width / 2;
  const ovalCY = oval.y + oval.height / 2;
  if (
    Math.abs(faceCX - ovalCX) > oval.width * 0.25 ||
    Math.abs(faceCY - ovalCY) > oval.height * 0.25
  )
    return "Center your face in the oval";

  return null;
};

export default function HomeScreen() {
  const { showActionSheetWithOptions } = useActionSheet();

  const insets = useSafeAreaInsets();

  const [images, setImages] = useState<Record<Slot, string | null>>({
    front: null,
    left: null,
    right: null,
  });
  const [name, setName] = useState("");
  const [enrollState, setEnrollState] = useState<EnrollState>("idle");
  const [enrolledList, setEnrolledList] = useState<EnrolledFaceEntry[]>([]);

  // Guided modal display state
  const [modalVisible, setModalVisible] = useState(false);
  const [modalStep, setModalStep] = useState(0);
  const [faceStatus, setFaceStatus] = useState<FaceStatus>("none");
  const [holdProgress, setHoldProgress] = useState(0);
  const [statusDetail, setStatusDetail] = useState("");
  const [cameraLayout, setCameraLayout] = useState<Layout>({
    width: 0,
    height: 0,
  });
  const [detectedFaces, setDetectedFaces] = useState<FaceBox[]>([]);
  // Refs to avoid stale closures inside the frequent onFacesDetected callback
  const modalStepRef = useRef(0);
  const isCapturingRef = useRef(false);
  const alignedSinceRef = useRef(0);

  const syncStep = (step: number) => {
    modalStepRef.current = step;
    setModalStep(step);
  };

  // ── Enrolled list ──────────────────────────────────────────────────────────

  const refreshList = useCallback(() => {
    const list = ExpoFaceRecognitionModule.listEnrolledFaces();
    setEnrolledList([...list].sort((a, b) => b.enrolledAt - a.enrolledAt));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  // ── Guided modal ───────────────────────────────────────────────────────────

  const captureFrame = async () => {
    if (isCapturingRef.current) return;
    isCapturingRef.current = true;
    alignedSinceRef.current = 0;
    setHoldProgress(0);
    setFaceStatus("none");
    try {
      const uri = await ExpoFaceRecognitionModule.captureFrameAsync();
      const slot = SLOT_KEYS[modalStepRef.current];
      setImages((prev) => ({ ...prev, [slot]: uri }));
      const next = modalStepRef.current + 1;
      if (next < ENROLL_STEPS.length) {
        syncStep(next);
      } else {
        setModalVisible(false);
        syncStep(0);
      }
    } catch {
      // capture failed — allow retry
    } finally {
      isCapturingRef.current = false;
    }
  };

  const handleModalFaces = ({
    nativeEvent,
  }: {
    nativeEvent: FacesDetectedPayload;
  }) => {
    if (isCapturingRef.current) return;
    const step = ENROLL_STEPS[modalStepRef.current];
    const face = nativeEvent.faces[0];

    setDetectedFaces(nativeEvent.faces);

    if (!face) {
      if (alignedSinceRef.current !== 0) {
        alignedSinceRef.current = 0;
        setFaceStatus("none");
        setHoldProgress(0);
      }
      return;
    }

    const yaw = face.yaw;
    const yawOk = yaw >= step.yawMin && yaw <= step.yawMax;
    const posIssue = getFaceIssue(face, cameraLayout);
    const allOk = !posIssue && yawOk;

    if (!allOk) {
      if (alignedSinceRef.current !== 0) {
        alignedSinceRef.current = 0;
        setHoldProgress(0);
      }
      setStatusDetail(posIssue ?? step.sub);
      setFaceStatus("detecting");
      return;
    }

    setFaceStatus("aligned");
    if (alignedSinceRef.current === 0) alignedSinceRef.current = Date.now();

    const elapsed = Date.now() - alignedSinceRef.current;
    setHoldProgress(Math.min(100, (elapsed / HOLD_MS) * 100));

    if (elapsed >= HOLD_MS) captureFrame();
  };

  const openGuidedModal = () => {
    StatusBar.setHidden(true, "slide");
    syncStep(0);
    setFaceStatus("none");
    setHoldProgress(0);
    alignedSinceRef.current = 0;
    isCapturingRef.current = false;
    setModalVisible(true);
  };

  const closeModal = () => {
    StatusBar.setHidden(false, "slide");
    setModalVisible(false);
    syncStep(0);
    setFaceStatus("none");
    setHoldProgress(0);
    alignedSinceRef.current = 0;
    isCapturingRef.current = false;
  };

  // ── Slot picking ───────────────────────────────────────────────────────────

  const pickLibraryForSlot = async (slot: Slot) => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (result && !result.canceled) {
      setImages((prev) => ({ ...prev, [slot]: result.assets[0].uri }));
      if (enrollState !== "idle") setEnrollState("idle");
    }
  };

  const pickForSlot = (slot: Slot) => {
    showActionSheetWithOptions(
      {
        options: ["Guided Camera Capture", "Choose from Library", "Cancel"],
        cancelButtonIndex: 2,
      },
      (idx) => {
        if (idx === 0) openGuidedModal();
        else if (idx === 1) pickLibraryForSlot(slot);
      },
    );
  };

  // ── Enrollment ─────────────────────────────────────────────────────────────

  const canEnroll = name.trim().length > 0 && images.front !== null;
  const filledCount = Object.values(images).filter(Boolean).length;

  const enroll = async () => {
    if (!canEnroll) return;
    setEnrollState("loading");
    try {
      const r = await ExpoFaceRecognitionModule.enrollFaceAsync(
        images.front!,
        name.trim(),
      );
      if (!r.success) {
        setEnrollState("error");
        Alert.alert(
          "No face detected",
          "Make sure a face is clearly visible in the front photo.",
        );
        return;
      }
      for (const slot of ["left", "right"] as Slot[]) {
        if (images[slot]) {
          try {
            await ExpoFaceRecognitionModule.addFaceEmbeddingAsync(
              images[slot]!,
              name.trim(),
            );
          } catch {
            /* non-fatal */
          }
        }
      }
      setEnrollState("success");
      refreshList();
    } catch (e: any) {
      setEnrollState("error");
      Alert.alert("Error", e?.message ?? "Enrollment failed.");
    }
  };

  const reset = () => {
    setImages({ front: null, left: null, right: null });
    setName("");
    setEnrollState("idle");
  };

  const confirmRemove = (personName: string) => {
    Alert.alert("Remove", `Remove "${personName}" from enrolled faces?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          ExpoFaceRecognitionModule.removeEnrolledFace(personName);
          refreshList();
        },
      },
    ]);
  };

  const formatDate = (ts: number) =>
    new Date(ts * 1000).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });

  // ── Modal derived values ───────────────────────────────────────────────────

  const ovalBorderColor =
    faceStatus === "aligned"
      ? "#4ade80"
      : faceStatus === "detecting"
        ? "#f59e0b"
        : "rgba(255,255,255,0.4)";

  const statusMsg =
    faceStatus === "none"
      ? "Position your face in the oval"
      : faceStatus === "detecting"
        ? statusDetail
        : "Hold still…";

  const currentStep = ENROLL_STEPS[modalStep];

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
      <View style={styles.root}>
        {/* ── Guided Enrollment Modal ─────────────────────────────────────── */}
        <Modal
          visible={modalVisible}
          animationType="slide"
          presentationStyle="fullScreen"
          onRequestClose={closeModal}
        >
          <View style={{ flex: 1, backgroundColor: "black" }}>
            {/* Top bar */}
            <View
              style={[
                styles.modalTopBar,
                { paddingTop: insets.top - 10, zIndex: 10, elevation: 10 },
              ]}
            >
              <Pressable style={styles.modalCloseBtn} onPress={closeModal}>
                <Text style={styles.modalCloseBtnText}>✕</Text>
              </Pressable>
              <Text style={styles.modalStepLabel}>
                Bước {modalStep + 1} / {ENROLL_STEPS.length}
              </Text>
              <View style={{ width: 40 }} />
            </View>

            {/* Live camera */}
            <ExpoFaceRecognitionView
              style={StyleSheet.absoluteFill}
              onFacesDetected={handleModalFaces}
              onLayout={(e) => setCameraLayout(e.nativeEvent.layout)}
            />

            {/* Debug: detected face rects in screen coords */}
            {cameraLayout.width > 0 && (
              <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
                {detectedFaces.map((f, i) => {
                  const r = faceToScreenRect(f, cameraLayout);
                  return (
                    <Rect
                      key={i}
                      x={r.x}
                      y={r.y}
                      width={r.width}
                      height={r.height}
                      stroke="#ff3b30"
                      strokeWidth={2}
                      fill="none"
                      rx={4}
                    />
                  );
                })}
              </Svg>
            )}

            {/* Face oval + progress — centered on screen */}
            <View style={styles.ovalContainer} pointerEvents="none">
              <View
                style={[styles.faceOval, { borderColor: ovalBorderColor }]}
              />
              {faceStatus === "aligned" && (
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${holdProgress}%` as any },
                    ]}
                  />
                </View>
              )}
            </View>

            {/* Bottom panel */}
            <View style={styles.modalBottom}>
              {/* Step dots */}
              <View style={styles.stepDots}>
                {ENROLL_STEPS.map((_, i) => (
                  <View
                    key={i}
                    style={[
                      styles.stepDot,
                      i < modalStep && styles.stepDotDone,
                      i === modalStep && styles.stepDotActive,
                    ]}
                  />
                ))}
              </View>

              <Text style={styles.modalInstruction}>{currentStep.label}</Text>
              <Text style={styles.modalStatus}>{statusMsg}</Text>

              {/* Shutter row */}
              <View style={styles.shutterRow}>
                <Pressable
                  style={styles.shutterBtn}
                  onPress={() => captureFrame()}
                >
                  <View style={styles.shutterInner} />
                </Pressable>
              </View>

              <Text style={styles.modalHint}>
                Tap button to capture manually
              </Text>
            </View>
          </View>
        </Modal>

        {/* ── Enroll section ─────────────────────────────────────────────────── */}
        <View style={styles.enrollSection}>
          <Text style={styles.title}>Enroll Face</Text>

          {/* 3 image slots */}
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

          {/* Guided capture CTA */}
          <Pressable style={styles.guidedBtn} onPress={openGuidedModal}>
            <Text style={styles.guidedBtnText}>📷 Guided Camera Capture</Text>
          </Pressable>

          <Text style={styles.slotHint}>
            {filledCount === 0
              ? "Capture from multiple angles for better accuracy"
              : `${filledCount} / 3 angle${filledCount > 1 ? "s" : ""} ready`}
          </Text>

          {/* Name */}
          <TextInput
            style={styles.nameInput}
            placeholder="Enter name…"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
            returnKeyType="done"
            autoCapitalize="words"
          />

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

          <View style={styles.actions}>
            {enrollState === "success" ? (
              <Pressable style={styles.btnPrimary} onPress={reset}>
                <Text style={styles.btnPrimaryText}>Enroll Another</Text>
              </Pressable>
            ) : (
              <Pressable
                style={[styles.btnPrimary, !canEnroll && styles.btnDisabled]}
                onPress={enroll}
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
                <Pressable style={styles.btnGhost} onPress={reset}>
                  <Text style={styles.btnGhostText}>Clear</Text>
                </Pressable>
              )}
          </View>
        </View>

        {/* ── Enrolled list ──────────────────────────────────────────────────── */}
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
                    {" · "}
                    <Text style={styles.listItemAngles}>
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
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0a0a0a" },

  // ── Enroll section ──
  enrollSection: {
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

  slotHint: { color: "#444", fontSize: 12, textAlign: "center" },

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

  // ── Guided modal ──
  modalTopBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  modalCloseBtn: {
    width: 30,
    height: 30,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  modalCloseBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  modalStepLabel: { color: "#fff", fontSize: 15, fontWeight: "600" },

  ovalContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  faceOval: {
    width: 220,
    height: 290,
    borderRadius: 140,
    borderWidth: 3,
  },
  progressTrack: {
    marginTop: 16,
    width: 220,
    height: 4,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderRadius: 2,
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: "#4ade80", borderRadius: 2 },

  modalBottom: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 24,
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: "center",
    gap: 10,
  },
  stepDots: { flexDirection: "row", gap: 8, marginBottom: 4 },
  stepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#444" },
  stepDotActive: { backgroundColor: "#fff", width: 20, borderRadius: 4 },
  stepDotDone: { backgroundColor: "#4ade80" },

  modalInstruction: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  modalStatus: { color: "#aaa", fontSize: 14, textAlign: "center" },

  shutterRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 24,
    marginTop: 4,
  },
  skipBtn: {
    width: 72,
    paddingVertical: 8,
    borderRadius: 50,
    borderWidth: 1,
    borderColor: "#555",
    alignItems: "center",
  },
  skipBtnText: { color: "#888", fontSize: 13, fontWeight: "600" },
  shutterBtn: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    borderColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  shutterInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#fff",
  },

  modalHint: { color: "#555", fontSize: 12, textAlign: "center" },

  // ── List section ──
  listSection: {
    flex: 1,
    marginTop: 16,
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
  listTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
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
  listItemAngles: { color: "#4ade80", fontSize: 12 },
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
