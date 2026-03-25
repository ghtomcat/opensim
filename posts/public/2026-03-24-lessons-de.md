# LinkedIn Post — Dienstag 2026-03-24 (DE)

---

Wir haben zwei Stunden verloren. Vollständig vermeidbar.

Ich baue OpenSim — einen Open-Source-Flugsimulator, der komplett im Browser läuft. Keine Dependencies. Kein Build-Step. Ein JSON für das Flugzeug, ein JSON für die Mission.

Letzte Woche: Physical-Modelling-Sound für den DB 605 — den V12-Kompressormotor der Messerschmitt Bf 109. Sample-by-sample, im Browser, in Echtzeit. Nach einer Nacht: kernig, rau, erkennbar. Der Sound einer Legende.

Dann kam der Auto-Compact.

Claude Code hat ein Kontext-Limit. Wenn er voll ist, komprimiert er automatisch — und Nuancen gehen verloren. Parameter, die wir mühsam erarbeitet hatten, wurden falsch wiederhergestellt. Wir merkten es erst, als der Sound plötzlich kaputt war. Eine Stunde Debugging. Dann noch eine.

Was ich daraus gelernt habe — und was jetzt in LESSONS.md im Repo steht:

**Checkpoints sofort speichern.** Nicht "nach dem nächsten Schritt". Genau dann, wenn etwas funktioniert. Der Moment des Erfolgs ist der gefährlichste — man will weitermachen. Tu es nicht. Speichere zuerst.

**Eine Änderung auf einmal.** Wir haben bodyDecay, noiseCoeff und Output-Mix gleichzeitig verändert. Als es danach schlechter war, wussten wir nicht mehr, was geholfen hatte und was nicht. Eine Änderung. Feedback holen. Nächste Änderung.

**Das Ohr ist Ground Truth.** Nicht die Theorie. Nicht die Spektralanalyse. Nicht das Oszilloskop. "Genial" und "total kaputt" sind vollständige Spezifikationen. Zwei Stunden haben wir damit verbracht, mathematisch zu erklären, warum etwas gut klingen sollte — obwohl das Ohr längst nein gesagt hatte.

**Wenn zwei Versuche hintereinander schlechter werden: stop.** Nicht nochmal. Nicht "nur noch einmal". Zum letzten funktionierenden Zustand zurück, Ursache verstehen, dann weitermachen. "One more try" ist wie man drei Stunden später mit etwas endet, das schlechter ist als am Anfang.

**Bei 10% Kontext: aufhören zu coden, Memory schreiben.** Bei 20% wäre es besser gewesen.

Das sind keine AI-Lektionen. Das ist Software-Engineering — aber AI macht die Konsequenzen von Ungeduld schneller sichtbar. Was früher einen Tag kostete, kostet jetzt eine Stunde. Inklusive dem Schmerz, wenn man es falsch macht.

In Open Source gibt es keine Secrets. Ship the checkpoint files. Ship the lessons learned. Ship the frustration. Die rohe Entwicklungsgeschichte ist wertvoller als polierte Dokumentation.

LESSONS.md ist jetzt im Repo. Für alle, die nachts mit AI bauen und dieselben Fehler vermeiden wollen.

github.com/ghtomcat/opensim

#OpenSource #BuildInPublic #ClaudeCode #AudioSynthesis #FlightSim #LessonsLearned

---
*Zeichen: ~2580*
