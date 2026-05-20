import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import type { EnrolledFaceEntry } from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";
import ExpoFaceRecognitionModule from "@/modules/expo-face-recognition/src/ExpoFaceRecognitionModule";

import type { EnrollState, Slot } from "@/types/enroll";
import EnrolledList from "../../components/view/enroll/EnrolledList";
import EnrollSection from "../../components/view/enroll/EnrollSection";
import GuidedEnrollModal from "../../components/view/enroll/GuidedEnrollModal";

export default function HomeScreen() {
  const [images, setImages] = useState<Record<Slot, string | null>>({
    front: null,
    left: null,
    right: null,
  });
  const [name, setName] = useState("");
  const [enrollState, setEnrollState] = useState<EnrollState>("idle");
  const [enrolledList, setEnrolledList] = useState<EnrolledFaceEntry[]>([]);
  const [modalVisible, setModalVisible] = useState(false);

  const refreshList = useCallback(() => {
    const list = ExpoFaceRecognitionModule.listEnrolledFaces();
    setEnrolledList([...list].sort((a, b) => b.enrolledAt - a.enrolledAt));
  }, []);

  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const pickLibrary = async (slot: Slot) => {
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

  const handleCapture = (slot: Slot, uri: string) => {
    setImages((prev) => ({ ...prev, [slot]: uri }));
  };

  const enroll = async () => {
    if (!images.front || !name.trim()) return;
    setEnrollState("loading");
    try {
      const r = await ExpoFaceRecognitionModule.enrollFaceAsync(
        images.front,
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

  const removeEnrolled = (personName: string) => {
    ExpoFaceRecognitionModule.removeEnrolledFace(personName);
    refreshList();
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top"]}>
      <View style={styles.root}>
        <GuidedEnrollModal
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onCapture={handleCapture}
        />

        <EnrollSection
          images={images}
          name={name}
          enrollState={enrollState}
          onOpenCamera={() => setModalVisible(true)}
          onPickLibrary={pickLibrary}
          onNameChange={setName}
          onEnroll={enroll}
          onReset={reset}
        />

        <EnrolledList data={enrolledList} onRemove={removeEnrolled} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  root: { flex: 1, backgroundColor: "#0a0a0a" },
});
