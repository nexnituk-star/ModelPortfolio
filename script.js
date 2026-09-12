"use strict";

const $ = (selector) => document.querySelector(selector);
const form = $("#application");
const downloadButton = $("#download");

const media = {
  video: [],
  room: [],
  body: []
};

const MAX_PHOTOS = 50;
const MAX_BYTES = 50 * 1000 * 1000;

let busy = false;

const allMedia = () => Object.values(media).flat();
const sizeMB = (bytes) => (bytes / 1000000).toFixed(2);
const fileKey = (file) => `${file.name}|${file.size}|${file.lastModified}`;

function element(tag, className = "", text = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
}

function message(selector, text, error = false) {
  const node = $(selector);
  node.textContent = text;
  node.hidden = !text;
  node.classList.toggle("error", error);
}

function setBusy(value, exporting = false) {
  busy = value;
  downloadButton.disabled = value;
  $("#form-fields").disabled = value && exporting;

  form.setAttribute("aria-busy", String(value));

  document
    .querySelectorAll("[data-upload], .preview button")
    .forEach((node) => {
      node.disabled = value;
    });
}

function localDate() {
  const now = new Date();

  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")
  ].join("-");
}

$("#dob").max = localDate();
$("#start-date").min = localDate();

try {
  const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [
          "UTC",
          "Asia/Kolkata",
          "Europe/London",
          "America/New_York",
          "Australia/Sydney"
        ];

  for (const zone of new Set([detected, "UTC", ...zones])) {
    if (zone) {
      $("#timezones").append(new Option(zone, zone));
    }
  }

  $("#timezone").value = detected || "UTC";
} catch {
  $("#timezone").value = "UTC";
}

$("#contact-method").addEventListener("change", () => {
  const email = $("#contact-method").value === "Email";
  const input = $("#contact");

  input.type = email ? "email" : "tel";
  input.autocomplete = email ? "email" : "tel";
  input.placeholder = email ? "you@example.com" : "+91 98765 43210";

  $("#contact-label").replaceChildren(
    document.createTextNode(
      email ? "Email address " : "Phone / WhatsApp number "
    ),
    element("small", "", "required")
  );
});

$("#payment").addEventListener("change", () => {
  const other = $("#payment").value === "Other";

  $("#other-payment-field").hidden = !other;
  $("#other-payment").disabled = !other;
  $("#other-payment").required = other;
});

function validateText(input) {
  if (
    input.matches(
      'textarea, input:not([type="file"]):not([type="radio"]):not([type="checkbox"])'
    )
  ) {
    input.setCustomValidity(
      input.required && !input.value.trim()
        ? "Complete this field."
        : ""
    );
  }
}

form.addEventListener("input", (event) => {
  validateText(event.target);
  message("#export-status", "");
});

async function makeThumbnail(file) {
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());

  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every(
    (byte, i) => bytes[i] === byte
  );

  if (!jpeg && !png) {
    throw new Error(`“${file.name}” is not a valid JPEG or PNG image.`);
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  let timer;

  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error(`“${file.name}” took too long to read.`)),
        20000
      );

      img.onload = resolve;
      img.onerror = () => reject(new Error(`“${file.name}” is damaged or unreadable.`));

      img.src = url;
    });

    const ratio = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Image processing is unavailable in this browser.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(img, 0, 0, canvas.width, canvas.height);

    const result = {
      file,
      thumb: canvas.toDataURL("image/jpeg", 0.84),
      width: canvas.width,
      height: canvas.height
    };

    canvas.width = canvas.height = 0;
    return result;
  } finally {
    clearTimeout(timer);
    img.onload = img.onerror = null;
    img.src = "";
    URL.revokeObjectURL(url);
  }
}

function renderMedia() {
  for (const [group, items] of Object.entries(media)) {
    const container = $(`#${group}-preview`);
    container.replaceChildren();

    for (const item of items) {
      const card = element(
        "figure",
        `preview${group === "video" ? " video-file" : ""}`
      );

      if (item.thumb) {
        const image = element("img");
        image.src = item.thumb;
        image.alt = `${group === "room" ? "Room" : "Full-body"} photo: ${item.file.name}`;

        card.append(image);
      } else {
        card.append(element("p", "", "Room video selected"));
      }

      card.append(
        element(
          "figcaption",
          "",
          `${item.file.name} · ${sizeMB(item.file.size)} MB`
        )
      );

      const remove = element("button", "", "Remove");
      remove.type = "button";
      remove.setAttribute("aria-label", `Remove ${item.file.name}`);

      remove.addEventListener("click", () => {
        if (busy) return;

        media[group] = media[group].filter((entry) => entry !== item);
        renderMedia();

        message("#upload-error", "");
        message("#export-status", "");
        message("#upload-status", `Removed ${item.file.name}.`);

        $(`[data-upload="${group}"]`).focus();
      });

      card.append(remove);
      container.append(card);
    }
  }

  const bytes = allMedia().reduce((sum, item) => sum + item.file.size, 0);

  $("#media-summary").textContent =
    `${media.room.length + media.body.length} / 50 photos · ${sizeMB(bytes)} / 50 MB`;

  $("#media-progress").value = bytes;
}

document.querySelectorAll("[data-upload]").forEach((input) => {
  input.addEventListener("change", async () => {
    const selected = [...input.files];
    input.value = "";

    if (busy || !selected.length) return;

    const group = input.dataset.upload;

    message("#upload-error", "");
    message("#export-status", "");
    message("#upload-status", "");

    try {
      const existing = group === "video" ? [...media.room, ...media.body] : allMedia();
      const seen = new Set(existing.map((entry) => fileKey(entry.file)));

      const incoming = selected.filter((file) => {
        const key = fileKey(file);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (!incoming.length) {
        message("#upload-status", "These files are already selected.");
        return;
      }

      if (group === "video" && incoming.length > 1) {
        throw new Error("Select one room video.");
      }

      for (const file of incoming) {
        if (!file.size) {
          throw new Error(`“${file.name}” is empty.`);
        }

        const valid =
          group === "video"
            ? /\.(mp4|webm|mov)$/i.test(file.name) &&
              (!file.type || /^(video\/(mp4|webm|quicktime))$/i.test(file.type))
            : /\.(jpe?g|png)$/i.test(file.name) &&
              (!file.type || /^(image\/(jpeg|png))$/i.test(file.type));

        if (!valid) {
          throw new Error(
            group === "video"
              ? "Choose an MP4, WebM, or MOV video."
              : "Photos must be JPEG or PNG files."
          );
        }
      }

      const photos =
        media.room.length + media.body.length + (group === "video" ? 0 : incoming.length);

      const bytes = [...existing.map((entry) => entry.file), ...incoming].reduce(
        (sum, file) => sum + file.size,
        0
      );

      if (photos > MAX_PHOTOS) {
        throw new Error(
          `This selection would total ${photos} photos. The limit is 50 across both photo fields.`
        );
      }

      if (bytes > MAX_BYTES) {
        throw new Error(
          `This selection would total ${sizeMB(bytes)} MB. All media together must fit within 50 MB.`
        );
      }

      setBusy(true);
      message("#upload-status", "Checking selected media…");

      const accepted = [];
      for (const file of incoming) {
        accepted.push(
          group === "video" ? { file } : await makeThumbnail(file)
        );
      }

      media[group] = group === "video" ? accepted : [...media[group], ...accepted];
      renderMedia();

      const skipped = selected.length - incoming.length;
      message(
        "#upload-status",
        `${accepted.length} file(s) added.` + (skipped ? ` ${skipped} duplicate(s) skipped.` : "")
      );
    } catch (error) {
      message("#upload-status", "");
      message(
        "#upload-error",
        `${error.message} Your earlier selections are unchanged.`,
        true
      );
    } finally {
      setBusy(false);
    }
  });
});

function validateMedia() {
  let error = "";
  let target = "#room-video";

  if (!media.video.length) {
    error = "Add a room and lighting video.";
  } else if (!media.room.length) {
    error = "Add room photos showing the lighting.";
    target = "#room-photos";
  } else if (media.body.length < 10) {
    error = `Add at least 10 full-body photos. You have ${media.body.length}.`;
    target = "#body-photos";
  } else if (
    media.room.length + media.body.length > MAX_PHOTOS ||
    allMedia().reduce((sum, item) => sum + item.file.size, 0) > MAX_BYTES
  ) {
    error = "Keep all media within 50 photos and 50 MB total.";
  }

  message("#upload-error", error, true);

  if (error) {
    $(target).focus();
  }

  return !error;
}

function getAnswers(section) {
  return [...section.querySelectorAll("[data-question]")]
    .filter((question) => !question.hidden)
    .map((question) => {
      const controls = [...question.querySelectorAll("input, select, textarea")];

      const answers = controls
        .filter(
          (input) => !["radio", "checkbox"].includes(input.type) || input.checked
        )
        .map((input) =>
          input.id === "google-chat"
            ? "Confirmed. I have installed Google Chat on my phone to share photos/videos during the process."
            : input.value.trim()
        );

      return [question.dataset.question, answers.filter(Boolean).join(", ") || "Not provided"];
    });
}

function buildPdfPages(stage) {
  let content;
  let sectionTitle = "";
  const pages = [];

  function newPage() {
    const page = element("article", "pdf-page");

    page.append(
      element("div", "pdf-header", "FRAME / TALENT     •     REMOTE MODELING PROFILE")
    );

    content = element("div", "pdf-content");
    page.append(content, element("div", "pdf-footer"));

    stage.append(page);
    pages.push(page);

    if (sectionTitle) {
      content.append(element("h2", "pdf-section", `${sectionTitle} (continued)`));
    }
  }

  const fits = () => content.scrollHeight <= content.clientHeight;

  function appendBlock(node) {
    content.append(node);

    if (!fits()) {
      node.remove();
      newPage();
      content.append(node);

      if (!fits()) {
        throw new Error("A media row exceeds the PDF page height.");
      }
    }
  }

  function addAnswer(label, value) {
    let remaining = Array.from(value);
    let continued = false;

    while (remaining.length) {
      const block = element("div", "pdf-answer");
      block.append(element("p", "pdf-label", label + (continued ? " (continued)" : "")));

      const answer = element("p", "pdf-value", remaining.join(""));
      block.append(answer);
      content.append(block);

      if (fits()) return;

      let low = 0;
      let high = remaining.length;

      while (low < high) {
        const middle = Math.ceil((low + high) / 2);
        answer.textContent = remaining.slice(0, middle).join("");

        if (fits()) {
          low = middle;
        } else {
          high = middle - 1;
        }
      }

      if (low === 0) {
        block.remove();
        newPage();
        continue;
      }

      let cut = low;
      const breakAt = remaining.slice(0, low).join("").search(/\s+\S*$/u);

      if (breakAt > 0) {
        const candidate = Array.from(remaining.slice(0, low).join("").slice(0, breakAt + 1)).length;
        if (candidate > low * 0.7) {
          cut = candidate;
        }
      }

      answer.textContent = remaining.slice(0, cut).join("");
      remaining = remaining.slice(cut);
      continued = true;
      newPage();
    }
  }

  function addGallery(title, items) {
    addAnswer(title, `${items.length} photo(s)`);

    for (let i = 0; i < items.length; i += 3) {
      const row = element("div", "pdf-row");

      for (const item of items.slice(i, i + 3)) {
        const figure = element("figure", "pdf-photo");
        const image = element("img");

        image.src = item.thumb;
        image.alt = item.file.name;

        const ratio = Math.min(208 / item.width, 180 / item.height);
        image.width = Math.max(1, Math.round(item.width * ratio));
        image.height = Math.max(1, Math.round(item.height * ratio));

        figure.append(
          image,
          element("figcaption", "", `${item.file.name}\n${sizeMB(item.file.size)} MB`)
        );

        row.append(figure);
      }

      appendBlock(row);
    }
  }

  newPage();
  addAnswer("Applicant", $("#full-name").value.trim());

  appendBlock(
    element(
      "p",
      "pdf-subtitle",
      `Generated ${new Date().toLocaleString()} · Applicant time zone: ${$("#timezone").value.trim()}`
    )
  );

  for (const section of document.querySelectorAll(".section")) {
    const nextTitle = section.querySelector("h2").textContent.trim();
    const heading = element("h2", "pdf-section", nextTitle);

    content.append(heading);
    if (!fits()) {
      heading.remove();
      sectionTitle = "";
      newPage();
      content.append(heading);
    }

    sectionTitle = nextTitle;

    for (const [label, value] of getAnswers(section)) {
      addAnswer(label, value);
    }

    if (section.id === "media") {
      addAnswer(
        "21. Room and lighting video",
        media.video
          .map(({ file }) => `${file.name} (${sizeMB(file.size)} MB)`)
          .join("\n") +
          "\nVideo content is not embedded. Share the original video separately."
      );

      addAnswer("Combined media", $("#media-summary").textContent);
      addGallery("21. Room and lighting photos", media.room);
      addGallery("23. Full-body pictures", media.body);
    }
  }

  pages.forEach((page, i) => {
    page.querySelector(".pdf-footer").textContent =
      "FRAME / TALENT  •  Personal application profile" + `                                      ${i + 1} / ${pages.length}`;
  });

  return pages;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (busy) return;

  form.querySelectorAll("input, textarea").forEach(validateText);

  if (!form.reportValidity()) {
    message(
      "#export-status",
      "Complete all required fields before downloading your PDF.",
      true
    );
    return;
  }

  if (!validateMedia()) {
    return;
  }

  if (!window.jspdf?.jsPDF || typeof window.html2canvas !== "function") {
    message(
      "#export-status",
      "PDF tools failed to load. Check your internet connection, then reload the page after keeping a copy of your answers.",
      true
    );
    return;
  }

  const stage = element("div", "pdf-stage");
  stage.setAttribute("aria-hidden", "true");
  document.body.append(stage);

  const buttonText = downloadButton.textContent;

  try {
    setBusy(true, true);
    downloadButton.textContent = "Preparing your PDF…";
    message("#export-status", "Preparing your profile and photos…");

    await document.fonts.ready;
    const pages = buildPdfPages(stage);

    await Promise.all([...stage.querySelectorAll("img")].map((image) => image.decode()));

    const pdf = new window.jspdf.jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
      compress: true
    });

    pdf.setProperties({
      title: "Remote Modeling Profile",
      creator: "FRAME Talent Portal"
    });

    for (let i = 0; i < pages.length; i++) {
      message("#export-status", `Rendering page ${i + 1} of ${pages.length}…`);

      const canvas = await window.html2canvas(pages[i], {
        scale: 1.5,
        backgroundColor: "#ffffff",
        logging: false,
        useCORS: true,
        width: 794,
        height: 1123,
        windowWidth: 1200,
        windowHeight: 1200,
        scrollX: 0,
        scrollY: 0
      });

      if (i > 0) pdf.addPage();

      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, 210, 297);
      canvas.width = canvas.height = 0;
    }

    const safeName = $("#full-name")
      .value.trim()
      .replace(/[^a-z0-9_-]+/gi, "_")
      .slice(0, 70) || "Applicant";

    await pdf.save(`${safeName}_Modeling_Profile.pdf`, { returnPromise: true });

    message("#export-status", "Your PDF is ready. The download has started.");
  } catch (error) {
    console.error("PDF export failed:", error);
    message(
      "#export-status",
      "PDF generation failed. Your entries remain here. Please try again.",
      true
    );
  } finally {
    stage.remove();
    setBusy(false);
    downloadButton.textContent = buttonText;
  }
});

downloadButton.disabled = false;
