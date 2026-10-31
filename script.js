(() => {
  "use strict";

  // ----- Configuration -----
  const API_BASE_URL = "https://mental-health-score-2emn.onrender.com";
  const PREDICT_URL = `${API_BASE_URL}/predict`;
  const REQUEST_TIMEOUT_MS = 60000;

  // Wake the backend early (Render free tier sleeps when idle)
  fetch(`${API_BASE_URL}/`).catch(() => {});

  // Field definitions mirror the FastAPI StudentData schema exactly.
  const FIELDS = [
    { name: "Age", label: "Age", type: "int", min: 10, max: 100 },
    { name: "Gender", label: "Gender", type: "choice", options: ["Male", "Female"] },
    { name: "Country", label: "Country", type: "text" },
    { name: "Academic_Level", label: "Academic level", type: "choice", options: ["Undergraduate", "Graduate", "High School"] },
    { name: "Most_Used_Platform", label: "Most used platform", type: "choice",
      options: ["Facebook", "LinkedIn", "Instagram", "Snapchat", "Twitter", "YouTube", "TikTok", "LINE", "KakaoTalk", "VKontakte", "WhatsApp", "WeChat"] },
    { name: "Purpose_Of_Use", label: "Purpose of use", type: "choice", options: ["Networking", "Education", "Entertainment", "News"] },
    { name: "Avg_Daily_Usage_Hours", label: "Average daily usage", type: "float", min: 0, max: 24 },
    { name: "Daily_Unlocks", label: "Daily unlocks", type: "int", min: 0 },
    { name: "Study_Hours", label: "Study hours", type: "float", min: 0, max: 24 },
    { name: "Physical_Activity_Hours", label: "Physical activity hours", type: "float", min: 0, max: 24 },
    { name: "Sleep_Hours_Per_Night", label: "Sleep hours", type: "float", min: 0, max: 24 },
    { name: "Stress_Level", label: "Stress level", type: "choice", options: ["Low", "Medium", "High", "Very High"] }
  ];

  // ----- DOM references -----
  const form = document.getElementById("assessment-form");
  const formCard = document.getElementById("form-card");
  const submitBtn = document.getElementById("submit-btn");
  const submitLabel = submitBtn.querySelector(".btn-label");
  const loadingEl = document.getElementById("loading");
  const formAlert = document.getElementById("form-alert");
  const resultCard = document.getElementById("result-card");
  const resultScore = document.getElementById("result-score");
  const resetBtn = document.getElementById("reset-btn");
  const navToggle = document.querySelector(".nav-toggle");
  const navLinks = document.getElementById("nav-links");

  let isSubmitting = false;

  // ----- Helpers: reading values -----
  function getRawValue(field) {
    if (field.type === "choice" && form.elements[field.name] instanceof RadioNodeList) {
      return form.elements[field.name].value;
    }
    return form.elements[field.name].value.trim();
  }

  // ----- Validation -----
  function validateField(field) {
    const raw = getRawValue(field);
    if (raw === "") return `Please enter or select ${field.label.toLowerCase()}.`;

    if (field.type === "int" || field.type === "float") {
      const number = Number(raw);
      if (!Number.isFinite(number)) return "Enter a valid number.";
      if (field.type === "int" && !Number.isInteger(number)) return "Enter a whole number.";
      if (field.min !== undefined && number < field.min) return `Value must be at least ${field.min}.`;
      if (field.max !== undefined && number > field.max) return `Value must be at most ${field.max}.`;
    }
    if (field.type === "choice" && !field.options.includes(raw)) {
      return "Choose one of the listed options.";
    }
    return "";
  }

  function showFieldError(field, message) {
    const errorEl = document.getElementById(`error-${field.name}`);
    errorEl.textContent = message;
    const control = form.elements[field.name];
    if (control instanceof RadioNodeList) {
      const group = form.querySelector(`[data-field="${field.name}"]`);
      group.classList.toggle("invalid", Boolean(message));
    } else if (message) {
      control.setAttribute("aria-invalid", "true");
    } else {
      control.removeAttribute("aria-invalid");
    }
  }

  function validateForm() {
    let firstInvalid = null;
    FIELDS.forEach((field) => {
      const message = validateField(field);
      showFieldError(field, message);
      if (message && !firstInvalid) firstInvalid = field;
    });
    return firstInvalid;
  }

  function focusField(field) {
    const control = form.elements[field.name];
    const target = control instanceof RadioNodeList ? control[0] : control;
    target.focus();
  }

  function clearAllErrors() {
    FIELDS.forEach((field) => showFieldError(field, ""));
    hideAlert();
  }

  // ----- Request body -----
  function buildRequestBody() {
    const body = {};
    FIELDS.forEach((field) => {
      const raw = getRawValue(field);
      if (field.type === "int") body[field.name] = parseInt(raw, 10);
      else if (field.type === "float") body[field.name] = parseFloat(raw);
      else body[field.name] = raw;
    });
    return body;
  }

  // ----- UI state -----
  function showAlert(message) {
    formAlert.textContent = message;
    formAlert.hidden = false;
  }
  function hideAlert() {
    formAlert.textContent = "";
    formAlert.hidden = true;
  }

  function setLoading(loading) {
    isSubmitting = loading;
    submitBtn.disabled = loading;
    submitBtn.setAttribute("aria-busy", String(loading));
    loadingEl.hidden = !loading;
    formCard.setAttribute("aria-busy", String(loading));
    submitLabel.textContent = "Analyzing...";
    if (!loading) {
      submitLabel.textContent = "Get my result";
    } else {
      const spinner = document.createElement("span");
      spinner.className = "btn-spinner";
      spinner.setAttribute("aria-hidden", "true");
      submitBtn.prepend(spinner);
    }
    if (!loading) {
      const spinner = submitBtn.querySelector(".btn-spinner");
      if (spinner) spinner.remove();
    }
  }

  // ----- API -----
  class ApiError extends Error {}

  async function requestPrediction(body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(PREDICT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") {
        throw new ApiError("The request took too long. Please try again in a moment.");
      }
      throw new ApiError("Cannot reach the prediction server. Please try again in a minute.");
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      if (response.status === 422) {
        await applyServerFieldErrors(response);
        throw new ApiError("The server rejected some answers. Please review the highlighted fields.");
      }
      if (response.status >= 500) {
        throw new ApiError("The server could not process your request. Please try again later.");
      }
      throw new ApiError("Your request could not be completed. Please check your answers and try again.");
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      throw new ApiError("The server sent an unreadable response. Please try again.");
    }

    const score = data && data.predicted_mental_health_score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new ApiError("The server sent an unexpected response, so no result can be shown.");
    }
    return score;
  }

  // FastAPI 422 responses list errors as detail[].loc = ["body", "<FieldName>"].
  async function applyServerFieldErrors(response) {
    try {
      const payload = await response.json();
      if (!payload || !Array.isArray(payload.detail)) return;
      payload.detail.forEach((item) => {
        const fieldName = Array.isArray(item.loc) ? item.loc[item.loc.length - 1] : null;
        const field = FIELDS.find((f) => f.name === fieldName);
        if (field) showFieldError(field, "Please check this value.");
      });
    } catch (error) {
      /* Ignore unreadable error bodies; the generic message is shown instead. */
    }
  }

  // ----- Result -----
  function showResult(score) {
    resultScore.textContent = score.toFixed(2);
    formCard.hidden = true;
    resultCard.hidden = false;
    resultCard.focus();
    resultCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function resetAssessment() {
    form.reset();
    clearAllErrors();
    resultCard.hidden = true;
    resultScore.textContent = "";
    formCard.hidden = false;
    const title = document.getElementById("assessment-title");
    title.focus();
    formCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ----- Event handlers -----
  async function handleSubmit(event) {
    event.preventDefault();
    if (isSubmitting) return;

    hideAlert();
    const firstInvalid = validateForm();
    if (firstInvalid) {
      showAlert("Please fix the highlighted fields and try again.");
      focusField(firstInvalid);
      return;
    }

    setLoading(true);
    try {
      const score = await requestPrediction(buildRequestBody());
      showResult(score);
    } catch (error) {
      // Entered values stay in the form so nothing has to be retyped.
      showAlert(error instanceof ApiError ? error.message : "Something went wrong. Please try again.");
      formAlert.scrollIntoView({ behavior: "smooth", block: "center" });
    } finally {
      setLoading(false);
    }
  }

  // Re-validate a field as soon as the user corrects it.
  function handleFieldChange(event) {
    const field = FIELDS.find((f) => f.name === event.target.name);
    if (!field) return;
    const hasError = document.getElementById(`error-${field.name}`).textContent !== "";
    if (hasError) showFieldError(field, validateField(field));
  }

  function toggleNav() {
    const open = navLinks.classList.toggle("open");
    navToggle.setAttribute("aria-expanded", String(open));
  }

  form.addEventListener("submit", handleSubmit);
  form.addEventListener("input", handleFieldChange);
  form.addEventListener("change", handleFieldChange);
  resetBtn.addEventListener("click", resetAssessment);
  navToggle.addEventListener("click", toggleNav);
  navLinks.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
})();
