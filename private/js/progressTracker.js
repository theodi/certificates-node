// progressTracker.js
export function calculateProgress(schemaQuestions, data, certProgress, selectedLanguage, survey) {
    // Reset levels
    Object.keys(certProgress.levels).forEach(level => {
      certProgress.levels[level].progress = 0;
      certProgress.levels[level].unmet = [];
      certProgress.levels[level].blocked = false; // Add blocked flag
    });
  
    const getText = (progressText) =>
      progressText?.[selectedLanguage] || progressText?.default || '';
  
    schemaQuestions.forEach((question) => {
      const answer = data[question.name];
      if (Array.isArray(question.choices)) {
        handleChoices(question, answer, certProgress, getText);
      } else if (question.type === 'boolean' || question.type === 'text' || question.type === 'comment') {
        handleSimple(question, answer, certProgress, getText);
      }
    });
  
    updateProgressUI(certProgress, survey);
  }
  
  function handleChoices(question, answer, certProgress, getText) {
    const selected = Array.isArray(answer) ? answer : (answer != null ? [answer] : []);
  
    // element-level requirements
    if (Array.isArray(question.requirements) && question.requirements.length) {
      question.requirements.forEach((req) => {
        checkRequirement(req, question.type, answer, certProgress, question.name, getText);
      });
    } else if (question.requirement) {
      checkRequirement(question.requirement, question.type, selected, certProgress, question.name, getText);
    }
  
    // choice-level requirements
    const isSingle = question.type === 'radiogroup';
    if (isSingle) {
      const selectedChoice = question.choices.find(c => c?.value === selected[0]);
      
      if (selectedChoice?.requirement?.level !== undefined) {
        const choiceLevel = selectedChoice.requirement.level;
        
        if (choiceLevel === 0) {
          // Level 0 blocks all levels
          Object.keys(certProgress.levels).forEach(level => {
            if (Number(level) > 0) {
              certProgress.levels[level].blocked = true;
              const reqText = getText(selectedChoice.requirement.progressText) || 'This choice blocks all levels';
              certProgress.levels[level].unmet.push({ 
                text: reqText, 
                questionName: question.name,
                blocking: true 
              });
            }
          });
        } else {
          // Normal level requirement
          incrementProgress(choiceLevel, certProgress);
        }
      }
  
      const choiceLevels = question.choices
        .filter(c => c?.requirement?.level !== undefined)
        .map(c => c.requirement.level);
  
      if (choiceLevels.length && !selectedChoice?.requirement) {
        const minLevel = Math.min(...choiceLevels);
        const minChoice = question.choices.find(c => c?.requirement?.level === minLevel);
        const reqText = minChoice?.requirement?.progressText
          ? getText(minChoice.requirement.progressText)
          : 'Requirement not met for this level';
        certProgress.levels[minLevel]?.unmet.push({ text: reqText, questionName: question.name });
      }
    } else {
      question.choices.forEach((choice) => {
        if (choice?.requirement?.level && selected.includes(choice.value)) {
          const choiceLevel = choice.requirement.level;
          if (choiceLevel === 0) {
            // Level 0 blocks all levels
            Object.keys(certProgress.levels).forEach(level => {
              if (Number(level) > 0) {
                certProgress.levels[level].blocked = true;
                const reqText = getText(choice.requirement.progressText) || 'This choice blocks all levels';
                certProgress.levels[level].unmet.push({ 
                  text: reqText, 
                  questionName: question.name,
                  blocking: true 
                });
              }
            });
          } else {
            incrementProgress(choiceLevel, certProgress);
          }
        }
      });
    }
  }
  
  function handleSimple(question, answer, certProgress, getText) {
    if (question.requirement?.level) {
      checkRequirement(question.requirement, question.type, answer, certProgress, question.name, getText);
    } else if (Array.isArray(question.requirements) && question.requirements.length) {
      question.requirements.forEach((req) => {
        checkRequirement(req, question.type, answer, certProgress, question.name, getText);
      });
    }
  }
  
  function checkRequirement(req, type, answer, certProgress, questionName, getText) {
    const level = req.level;
    let met = false;
  
    if (type === 'boolean') {
      met = req.requireTrue === false
        ? (answer !== undefined && answer !== null)
        : (answer === true);
    } else {
      met = Array.isArray(answer)
        ? answer.length > 0
        : (answer != null && String(answer).trim().length > 0);
    }
  
    if (met) {
      incrementProgress(level, certProgress);
    } else {
      certProgress.levels[level]?.unmet.push({
        text: getText(req.progressText),
        questionName
      });
    }
  }
  
  function incrementProgress(level, certProgress) {
    for (let i = 1; i <= level; i++) {
      certProgress.levels[i].progress++;
    }
  }
  
  export function updateProgressUI(certProgress, survey) {
    const container = document.getElementById('certificationProgressDetail');
    if (!container) return;
    container.innerHTML = '';
  
    // Get level names from survey
    const getLevelName = (level) => {
      console.log(survey);
      if (!survey || !survey.jsonObj) return `Level ${level}`;
      
      const surveyData = survey.jsonObj;
      let levelName = `Level ${level}`;
      
      // Try to get from survey.levels map
      if (surveyData.levels) {
        const levelsMap = surveyData.levels instanceof Map ? Object.fromEntries(surveyData.levels) : surveyData.levels;
        const levelInfo = levelsMap[String(level)];
        if (levelInfo && levelInfo.title) {
          levelName = levelInfo.title;
        }
      }
      
      return levelName;
    };
  
    Object.keys(certProgress.levels)
      .filter(lvl => Number(lvl) > 0)
      .forEach(level => {
        const { progress, unmet, blocked } = certProgress.levels[level];
        const uniqueUnmet = deduplicateUnmet(unmet);
        const total = progress + uniqueUnmet.length;
        const pct = total > 0 ? (progress / total) * 100 : 0;
        const levelName = getLevelName(level);
  
        let statusHtml = '';
        if (blocked) {
          const blockingReqs = uniqueUnmet.filter(req => req.blocking);
          statusHtml = `<div class="level-blocked">
            <p><strong>This level is blocked by the following requirements:</strong></p>
            <ul>${blockingReqs.map(req =>
              `<li><a href="#" class="navigate-to-question" data-question-name="${req.questionName}">${req.text}</a></li>`
            ).join('')}</ul>
          </div>`;
        } else if (uniqueUnmet.length) {
          statusHtml = `<details><summary>${uniqueUnmet.length} unmet requirements</summary>
            <ul>${uniqueUnmet.map(req =>
              `<li><a href="#" class="navigate-to-question" data-question-name="${req.questionName}">${req.text}</a></li>`
            ).join('')}</ul>
          </details>`;
        } else {
          statusHtml = `<p>All requirements met for this level.</p>`;
        }
  
        const progressBarClass = blocked ? 'progress-bar blocked' : 'progress-bar';
        const progressBarStyle = blocked ? 'width:0%' : `width:${pct}%`;
  
        container.insertAdjacentHTML('beforeend', `
          <div class="level-progress ${blocked ? 'level-blocked' : ''}">
            <h4>Level ${level} - ${levelName}</h4>
            <div class="${progressBarClass}"><div style="${progressBarStyle}"></div></div>
            <p>${progress} out of ${total} requirements met (${Math.round(pct)}%)</p>
            ${statusHtml}
          </div>
        `);
      });
  
    container.querySelectorAll('.navigate-to-question').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const qName = e.currentTarget.dataset.questionName;
        navigateToQuestion(qName, survey);
      });
    });
  }
  
  function deduplicateUnmet(unmet) {
    const seen = new Set();
    return (unmet || []).filter(req => {
      const key = `${req.questionName}::${req.text}::${req.blocking || false}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  
  export function navigateToQuestion(questionName, survey) {
    if (!survey) return;
    const question = survey.getQuestionByName(questionName);
    if (!question) return;
  
    const targetPageIndex = survey.pages.indexOf(question.page);
    const samePage = survey.currentPageNo === targetPageIndex;
  
    const highlight = (el) => {
      if (!el) return;
      // Remove any previous highlight first
      document.querySelectorAll('.flash-highlight').forEach(n => n.classList.remove('flash-highlight'));
      el.classList.add('flash-highlight');
      // Try to focus an interactive control inside the question
      const focusable = el.querySelector('input, select, textarea, button, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus({ preventScroll: true });
      // Clean up highlight class after the animation
      setTimeout(() => el.classList.remove('flash-highlight'), 1600);
    };
  
    const tryScroll = () => {
      const el = document.querySelector(`[data-name="${questionName}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        highlight(el);
        return true;
      }
      return false;
    };
  
    if (samePage) {
      if (!tryScroll()) {
        requestAnimationFrame(() => tryScroll());
        setTimeout(() => tryScroll(), 60);
      }
      return;
    }
  
    const handler = (sender, options) => {
      if (options?.question?.name === questionName) {
        tryScroll();
        survey.onAfterRenderQuestion.remove(handler);
      }
    };
  
    survey.onAfterRenderQuestion.add(handler);
  
    const fallback = setTimeout(() => {
      tryScroll();
      survey.onAfterRenderQuestion.remove(handler);
    }, 120);
  
    survey.currentPageNo = targetPageIndex;
  }
  
  
    