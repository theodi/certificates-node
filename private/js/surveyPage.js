// surveyPage.js
import { calculateProgress, navigateToQuestion } from './progressTracker.js';

(() => {
  let survey = null;
  const certProgress = { levels: {} };   // keep name different to DOM id
  let selectedLanguage = 'en';

  document.addEventListener('DOMContentLoaded', initSurvey);

  async function initSurvey() {
    const { responseSetId, surveyId, datasetId } = window.surveyConfig;
    clearForm();

    const [schema, rs] = await Promise.all([
      fetch(`/surveys/${surveyId}`, { headers: { Accept: 'application/json' } }).then(r => r.json()),
      fetch(`/datasets/${encodeURIComponent(datasetId)}/certificates/${responseSetId}`, { headers: { Accept: 'application/json' } }).then(r => r.json()),
    ]);

    setupSurvey(schema, rs, datasetId, responseSetId);
  }

  function clearForm() {
    $('#dataForm').html('');
    $('#res').html('');
    $('form').show();
  }

  function setupSurvey(schema, rs, datasetId, responseSetId) {
    try { Survey.surveyLocalization.supportedLocales = ['en']; } catch (_) {}
    survey = new Survey.Model(schema);
    try { survey.allowHtml = true; } catch (_) {}

    setupLanguage(schema);
    survey.showProgressBar = 'off';
    survey.showQuestionNumbers = 'off';

    const schemaQuestions = getAllQuestionsFromSchema(schema);
    initializeProgress(schemaQuestions);

    const initialData = extractInitialData(rs);

    // initial progress render
    calculateProgress(
      filterVisibleSchemaQuestions(schemaQuestions),
      initialData,
      certProgress,
      selectedLanguage,
      survey
    );

    buildSidebar(schema);
    setupAutoSave(schemaQuestions, datasetId, responseSetId);
    setupSurveyRendering(schemaQuestions, schema, initialData);

    $('#surveyElement').Survey({ model: survey });
  }

  function setupLanguage(schema) {
    const langSelect = document.getElementById('languageSelector');
    const supported = Array.isArray(schema.supportedLanguages) ? schema.supportedLanguages : null;

    if (supported?.length) {
      try { Survey.surveyLocalization.supportedLocales = supported; } catch (_) {}
      if (langSelect) {
        langSelect.innerHTML = supported.map(code => `<option value="${code}">${code.toUpperCase()}</option>`).join('');
        langSelect.disabled = false;
        langSelect.style.display = '';
      }
      survey.locale = langSelect?.value || supported[0];
      selectedLanguage = survey.locale;
    } else {
      if (langSelect) { langSelect.disabled = true; langSelect.style.display = 'none'; }
      survey.locale = 'en';
      selectedLanguage = 'en';
    }

    if (langSelect && !langSelect.disabled) {
      langSelect.addEventListener('change', () => {
        survey.locale = langSelect.value;
        selectedLanguage = langSelect.value;
        calculateProgress(
          filterVisibleSchemaQuestions(getAllQuestionsFromSchema(survey.json)),
          survey.data,
          certProgress,
          selectedLanguage,
          survey
        );
      });
    }
  }

  function extractInitialData(rs) {
    const initialData = {};
    if (rs?.responses) {
      for (const [k, v] of Object.entries(rs.responses)) {
        if (v && typeof v === 'object' && 'value' in v) initialData[k] = v.value;
      }
    }
    return initialData;
  }

  function filterVisibleSchemaQuestions(schemaQuestions) {
    const visibleQuestions = survey.getAllQuestions().filter(q => q.isVisible);
    return schemaQuestions.filter(schemaQuestion =>
      visibleQuestions.some(surveyQuestion => surveyQuestion.name === schemaQuestion.name)
    );
  }

  function buildSidebar(schema) {
    const sidebar = document.getElementById('sidebar');
    schema.pages.forEach((page, index) => {
      const pageLink = document.createElement('button');
      pageLink.textContent = page.title?.default || page.title || `Page ${index + 1}`;
      pageLink.style.display = 'block';
      pageLink.style.marginBottom = '10px';
      pageLink.onclick = () => { survey.currentPageNo = index; };
      sidebar.appendChild(pageLink);
    });
  }

  function setupAutoSave(schemaQuestions, datasetId, responseSetId) {
    const saveQueue = new Map();
    let saveTimer = null;

    function scheduleSave(name, value) {
      saveQueue.set(name, { value });
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(async () => {
        const payload = { responses: Object.fromEntries(saveQueue.entries()) };
        saveQueue.clear();
        try {
          const resp = await fetch(`/datasets/${encodeURIComponent(datasetId)}/certificates/${responseSetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify(payload),
          });
          const data = await resp.json();
          if (data?.progress?.levels) {
            calculateProgress(
              filterVisibleSchemaQuestions(schemaQuestions),
              survey.data,
              certProgress,
              selectedLanguage,
              survey
            );
          }
        } catch (e) {
          console.error('Autosave failed', e);
        }
      }, 400);
    }

    survey.onValueChanged.add((sender, options) => {
      calculateProgress(
        filterVisibleSchemaQuestions(schemaQuestions),
        sender.data,
        certProgress,
        selectedLanguage,
        survey
      );
      if (options?.name) scheduleSave(options.name, options.value);
    });
  }

  function setupSurveyRendering(schemaQuestions, schema, initialData) {
    survey.onAfterRenderSurvey?.add?.((_, options) => applySurveyHeaderHtml(options.htmlElement, survey));
    survey.onAfterRenderPage?.add?.((_, options) => applyPageHtml(options.page, options.htmlElement, survey));
    survey.onAfterRenderQuestion.add((_, options) => applyQuestionHtml(options.question, options.htmlElement, survey));

    survey.data = initialData;
    setTimeout(() => {
      calculateProgress(
        filterVisibleSchemaQuestions(schemaQuestions),
        survey.data,
        certProgress,
        selectedLanguage,
        survey
      );
    }, 0);
  }

  function getAllQuestionsFromSchema(schema) {
    const questions = [];
    const traverse = (elements) => elements.forEach(el => {
      if ((el.type === 'panel' || el.type === 'paneldynamic') && el.elements) traverse(el.elements);
      else if (el.type) questions.push(el);
    });
    schema.pages.forEach(page => page.elements && traverse(page.elements));
    return questions;
  }

  function initializeProgress(schemaQuestions) {
    const levels = [];
    schemaQuestions.forEach(q => {
      if (Array.isArray(q.choices)) q.choices.forEach(c => c?.requirement?.level !== undefined && levels.push(c.requirement.level));
      if (q?.requirement?.level !== undefined) levels.push(q.requirement.level);
      if (Array.isArray(q.requirements)) q.requirements.forEach(r => r?.level !== undefined && levels.push(r.level));
    });
    const maxLevel = levels.length ? Math.max(...levels) : 4;
    for (let i = 1; i <= maxLevel; i++) certProgress.levels[i] = { progress: 0, unmet: [] };
  }

  // --- HTML sanitizers (kept local to avoid extra imports) ---
  function localized(textOrObj, locale) {
    if (!textOrObj) return '';
    if (typeof textOrObj === 'string') return textOrObj;
    if (typeof textOrObj === 'object') return textOrObj[locale] || textOrObj.default || '';
    return '';
  }

  function applySurveyHeaderHtml(htmlElement, survey) {
    if (!htmlElement) return;
    const titleEl = htmlElement.querySelector('.sd-title.sd-element__title, .sd-title, [data-testid="survey-title"]');
    const descEl = htmlElement.querySelector('.sd-description.sd-element__description, .sd-description, [data-testid="survey-description"]');
    const titleHtml = localized(survey.title, survey.locale);
    const descHtml = localized(survey.description, survey.locale);
    if (titleEl && titleHtml && window.DOMPurify && /[<>]/.test(titleHtml)) titleEl.innerHTML = DOMPurify.sanitize(titleHtml);
    if (descEl && descHtml && window.DOMPurify) descEl.innerHTML = DOMPurify.sanitize(descHtml);
  }

  function applyPageHtml(page, htmlElement, survey) {
    if (!htmlElement || !page) return;
    const pageTitleEl = htmlElement.querySelector('.sd-page__title, .sd-title, [data-testid="page-title"]');
    const pageDescEl = htmlElement.querySelector('.sd-page__description, .sd-description, [data-testid="page-description"]');
    const pageTitleHtml = localized(page.title, survey.locale);
    const pageDescHtml = localized(page.description, survey.locale);
    if (pageTitleEl && pageTitleHtml && window.DOMPurify && /[<>]/.test(pageTitleHtml)) pageTitleEl.innerHTML = DOMPurify.sanitize(pageTitleHtml);
    if (pageDescEl && pageDescHtml && window.DOMPurify) pageDescEl.innerHTML = DOMPurify.sanitize(pageDescHtml);
  }

  function applyQuestionHtml(question, htmlElement, survey) {
    if (!htmlElement) return;
    const titleEl = htmlElement.querySelector('.sd-question__title .sv-string-viewer');
    const descEl = htmlElement.querySelector('.sd-question__description, .sd-description, [data-testid="question-description"]');
    const titleHtml = localized(question.locTitle?.text ? question.locTitle.text : question.title, survey.locale);
    const descHtml = localized(question.description, survey.locale);
    if (titleEl && titleHtml && window.DOMPurify && /[<>]/.test(titleHtml)) titleEl.innerHTML = DOMPurify.sanitize(titleHtml);
    if (descEl && descHtml && window.DOMPurify) descEl.innerHTML = DOMPurify.sanitize(descHtml);
  }
})();