/*
 * Copyright (C) 2011 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import FileUploadQuestionView from 'compiled/views/quizzes/FileUploadQuestionView'
import File from 'compiled/models/File'
import I18n from 'i18n!quizzes.take_quiz'
import $ from 'jquery'
import autoBlurActiveInput from 'compiled/behaviors/autoBlurActiveInput'
import _ from 'underscore'
import LDBLoginPopup from 'compiled/views/quizzes/LDBLoginPopup'
import quizTakingPolice from 'quizzes/quiz_taking_police'
import QuizLogAuditing from 'compiled/quizzes/log_auditing'
import QuizLogAuditingEventDumper from 'compiled/quizzes/dump_events'
import KeyboardShortcuts from 'compiled/views/editor/KeyboardShortcuts'
import RichContentEditor from 'jsx/shared/rce/RichContentEditor'
import './jquery.ajaxJSON'
import './jquery.toJSON'
import './jquery.instructure_date_and_time' /* friendlyDatetime, friendlyDate */
import './jquery.instructure_forms' /* getFormData, errorBox */
import 'jqueryui/dialog'
import 'compiled/jquery.rails_flash_notifications'
import './vendor/jquery.scrollTo'
import 'compiled/behaviors/quiz_selectmenu'

  RichContentEditor.preloadRemoteModule();

  var lastAnswerSelected = null;
  var lastSuccessfulSubmissionData = null;
  var showDeauthorizedDialog;

  var quizSubmission = (function() {
    var timeMod = 0,
        endAt = $(".end_at"),
        endAtParsed = endAt.text() && new Date(endAt.text()),
        dueAt = $(".due_at"),
        dueAtParsed = dueAt.text() && new Date(dueAt.text()),
        startedAt = $(".started_at"),
        inBackground = false,
        $countdownSeconds = $(".countdown_seconds"),
        $timeRunningTimeRemaining = $(".time_running,.time_remaining"),
        $lastSaved = $('#last_saved_indicator');

    return {
      countDown: null,
      fiveMinuteDeadline: false,
      oneMinuteDeadline: false,
      submitting: false,
      dialogged: false,
      inBackground: false,
      contentBoxCounter: 0,
      lastSubmissionUpdate: new Date(),
      currentlyBackingUp: false,
      endAt: endAt,
      endAtParsed: endAtParsed,
      startedAt: startedAt,
      hasTimeLimit: !!ENV.QUIZ.time_limit,
      timeLeft: parseInt($(".time_left").text()) * 1000,
      timeToDueDate: dueAtParsed - new Date(),
      oneAtATime: $("#submit_quiz_form").hasClass("one_question_at_a_time"),
      cantGoBack: $("#submit_quiz_form").hasClass("cant_go_back"),
      finalSubmitButtonClicked: false,
      clockInterval: 500,
      backupsDisabled: document.location.search.search(/backup=false/) > -1,
      clearAccessCode: true,
      updateSubmission: function(repeat, autoInterval) {
        /**
         * Transient: CNVS-9844
         * Disable auto-backups if backup=true was passed as a query parameter.
         *
         * This is required to test updating questions via the API.
         */
        if (quizSubmission.backupsDisabled) {
          return;
        }

        if(quizSubmission.submitting && !repeat) { return; }
        var now = new Date();
        if(!autoInterval && (now - quizSubmission.lastSubmissionUpdate) < 1000) {
          return;
        }
        if(quizSubmission.currentlyBackingUp) { return; }

        quizSubmission.currentlyBackingUp = true;
        quizSubmission.lastSubmissionUpdate = new Date();
        var data = $("#submit_quiz_form").getFormData();

        $(".question_holder .question").each(function() {
          var value = ($(this).hasClass("marked")) ? "1" : "";
          data[$(this).attr('id') + "_marked"] = value;
        });

        $lastSaved.text(I18n.t('saving', 'Saving...'));
        var url = $(".backup_quiz_submission_url").attr('href');
        (function(submissionData) {
          // Need a shallow clone of the data here because $.ajaxJSON modifies in place
          var thisSubmissionData = _.clone(submissionData);
          // If this is a timeout-based submission and the data is the same as last time,
          // palliate the server by skipping the data submission
          if (!quizSubmission.inBackground && repeat && _.isEqual(submissionData, lastSuccessfulSubmissionData)) {
            $lastSaved.text(I18n.t('saving_not_needed', "No new data to save. Last checked at %{t}", { t: $.friendlyDatetime(new Date()) }));

            quizSubmission.currentlyBackingUp = false;

            setTimeout(function() { quizSubmission.updateSubmission(true, true) }, 30000);
            return;
          }
          $.ajaxJSON(url, 'PUT', submissionData,
            // Success callback
            function(data) {
              lastSuccessfulSubmissionData = thisSubmissionData;
              $lastSaved.text(I18n.t('saved_at', 'Quiz saved at %{t}', { t: $.friendlyDatetime(new Date()) }));
              quizSubmission.currentlyBackingUp = false;
              quizSubmission.inBackground = false;
              if(repeat) {
                setTimeout(function() {quizSubmission.updateSubmission(true, true) }, 30000);
              }
              if(data && data.end_at) {
                var endAtFromServer     = Date.parse(data.end_at),
                    submissionEndAt     = Date.parse(endAt.text()),
                    serverEndAtTime     = endAtFromServer.getTime(),
                    submissionEndAtTime = submissionEndAt.getTime();

                quizSubmission.timeLeft = data.time_left * 1000;

                // if the new endAt from the server is different than our current endAt, then notify
                // the user that their time limit's changed and let updateTime do the rest.
                if (serverEndAtTime !== submissionEndAtTime) {
                    if(serverEndAtTime > submissionEndAtTime) {
                      $.flashMessage(I18n.t('You have been given extra time on this attempt'))
                    } else {
                      $.flashMessage(I18n.t('Your time for this quiz has been reduced.'));
                    }

                  quizSubmission.endAt.text(data.end_at);
                  quizSubmission.endAtParsed = endAtFromServer;
                }
              }
            },
            // Error callback
            function(resp, ec) {
              quizSubmission.currentlyBackingUp = false;

              // has the user logged out?
              // TODO: support this redirect in LDB, by getting out of high security mode.
              if (ec.status === 401 || resp['status'] == 'unauthorized') {
                showDeauthorizedDialog();
                // since we popped up our own "not logged in" modal, skip the default error handler
                // see jquery.ajaxJSON.js defaultAjaxError
                if ($.inArray(ec, $.ajaxJSON.ignoredXHRs) === -1) {
                  $.ajaxJSON.ignoredXHRs.push(ec)
                }
              }
              else {
                // Connectivity lost?
                var current_user_id = window.ENV.current_user_id || "none";
                $.ajaxJSON(
                  location.protocol + '//' + location.host + "/simple_response.json?user_id=" + current_user_id + "&rnd=" + Math.round(Math.random() * 9999999),
                  'GET', {},
                  function() {},
                  function() {
                    $.flashError(I18n.t('errors.connection_lost', "Connection to %{host} was lost.  Please make sure you're connected to the Internet before continuing.", {'host': location.host}));
                  }
                );
              }

              if(repeat) {
                setTimeout(function() {quizSubmission.updateSubmission(true) }, 30000);
              }
            },
            {
              timeout: 15000
            }
          );
        })(data);
      },

      updateTime: function() {
        var currentTimeLeft = quizSubmission.timeLeft = quizSubmission.timeLeft - quizSubmission.clockInterval;
        var currentTimeToDueDate = null;
        if (quizSubmission.timeToDueDate > 0) {
          currentTimeToDueDate = quizSubmission.timeToDueDate = quizSubmission.timeToDueDate - quizSubmission.clockInterval;
        }
        var now = new Date();
        var endAt = quizSubmission.endAt.text();

        timeMod = (timeMod + 1) % 120;
        if(timeMod == 0 && !endAt && !quizSubmission.twelveHourDeadline) {
          var end = quizSubmission.endAtParsed;
        }

        currentTimeLeft = quizSubmission.floorTimeLeft(currentTimeLeft);

        if(quizSubmission.countDown) {
          var s = new Date((quizSubmission.countDown - now.getTime())).getUTCSeconds();
          if(now.getTime() < quizSubmission.countDown) { $countdownSeconds.text(s); }

          if(s <= 0 && !quizSubmission.submitting) {
            quizSubmission.submitting = true;
            quizSubmission.submitQuiz();
          }
        }

        if(quizSubmission.isTimeUp(currentTimeLeft) && !ENV.IS_PREVIEW) {
          quizSubmission.showTimeUpDialog(now);
        } else if(currentTimeToDueDate != null && currentTimeLeft > currentTimeToDueDate) {
          quizSubmission.showDueDateWarnings(currentTimeToDueDate);
          quizSubmission.showWarnings(currentTimeLeft);
        } else if(currentTimeLeft == null) {
          quizSubmission.showDueDateWarnings(currentTimeToDueDate);
        } else {
          quizSubmission.showWarnings(currentTimeLeft);
        }
        quizSubmission.updateTimeDisplay(currentTimeLeft);
      },

      floorTimeLeft: function(timeLeft) {
        if(timeLeft < 1000) {
          timeLeft = 0;
        }

        return timeLeft;
      },

      isTimeUp: function(currentTimeLeft) {
        return currentTimeLeft < 1000 && !quizSubmission.dialogged;
      },
      showDueDateWarnings: function(currentTimeToDueDate) {
        if(currentTimeToDueDate > 30000 && currentTimeToDueDate < 60000 && !quizSubmission.oneMinuteDueDateDeadline) {
          quizSubmission.oneMinuteDueDateDeadline = true;
          $.flashMessage(I18n.t('notices.due_date_one_minute_left', "One Minute Left Before Quiz Will Be Marked Late"));
        } else if(currentTimeToDueDate > 250000 && currentTimeToDueDate < 300000 && !quizSubmission.fiveMinuteDueDateDeadline) {
          quizSubmission.fiveMinuteDueDateDeadline = true;
          $.flashMessage(I18n.t('notices.due_date_five_minutes_left', "Five Minutes Left Before Quiz Will Be Marked Late"));
        } else if(currentTimeToDueDate > 1770000 && currentTimeToDueDate < 1800000 && !quizSubmission.thirtyMinuteDueDateDeadline) {
          quizSubmission.thirtyMinuteDueDateDeadline = true;
          $.flashMessage(I18n.t('notices.due_date_thirty_minutes_left', "Thirty Minutes Left Before Quiz Will Be Marked Late"));
        }
      },
      showWarnings: function(currentTimeLeft) {
        if(currentTimeLeft > 30000 && currentTimeLeft < 60000 && !quizSubmission.oneMinuteDeadline) {
          quizSubmission.oneMinuteDeadline = true;
          $.flashWarning(I18n.t('notices.submission_one_minute_left', "This Quiz Will Be Submitted In One Minute"), 5000);
        } else if(currentTimeLeft > 250000 && currentTimeLeft < 300000 && !quizSubmission.fiveMinuteDeadline) {
          quizSubmission.fiveMinuteDeadline = true;
          $.flashWarning(I18n.t('notices.submission_five_minutes_left', "This Quiz Will Be Submitted In Five Minutes"), 5000);
        } else if(currentTimeLeft > 1770000 && currentTimeLeft < 1800000 && !quizSubmission.thirtyMinuteDeadline) {
          quizSubmission.thirtyMinuteDeadline = true;
          $.flashWarning(I18n.t('notices.submission_thirty_minutes_left', "This Quiz Will Be Submitted In Thirty Minutes"), 5000);
        }
      },

      showTimeUpDialog: function(now) {
        quizSubmission.dialogged = true;
        quizSubmission.countDown = new Date(now.getTime() + 10000);

        $("#times_up_dialog").show().dialog({
          title: I18n.t('titles.times_up', "Time's Up!"),
          width: "auto",
          height: "auto",
          modal: true,
          overlay: {
            backgroundColor: "#000",
            opacity: 0.7
          },
          close: function() {
            if(!quizSubmission.submitting) {
              quizSubmission.submitting = true;
              quizSubmission.submitQuiz();
            }
          }
        });

      },

      getTimeElapsed: function() {
        $(".time_header").text(I18n.beforeLabel(I18n.t('labels.time_elapsed', "Time Elapsed")));
        var now = new Date().getTime();
        var startedAt = Date.parse(quizSubmission.startedAt.text()).getTime();
        return now - startedAt;
      },

      updateTimeDisplay: function(currentTimeLeft) {
        if(quizSubmission.hasTimeLimit) {
          quizSubmission.updateTimeString(currentTimeLeft);
        } else {
          quizSubmission.updateTimeString(quizSubmission.getTimeElapsed());
        }
      },

      updateTimeString: function(timeDiff) {
        var date = new Date(Math.abs(timeDiff));
        var yr = date.getUTCFullYear() - 1970;
        var mon = date.getUTCMonth();
        var day = date.getUTCDate() - 1;
        var hr = date.getUTCHours();
        var min = date.getUTCMinutes();
        var sec = date.getUTCSeconds();
        var times = [];
        if(yr) { times.push(I18n.t('years_count', "Year", {'count': yr})); }
        if(mon) { times.push(I18n.t('months_count', "Month", {'count': mon})); }
        if(day) { times.push(I18n.t('days_count', "Day", {'count': day})); }
        if(hr) { times.push(I18n.t('hours_count', "Hour", {'count': hr})); }
        if(true || min) { times.push(I18n.t('minutes_count', "Minute", {'count': min})); }
        if(true || sec) { times.push(I18n.t('seconds_count', "Second", {'count': sec})); }
        $timeRunningTimeRemaining.text(times.join(", "));
      },

      updateFinalSubmitButtonState: function() {
        var allQuestionsAnswered = ($("#question_list li:not(.answered)").length == 0);
        var lastQuizPage = ($("#submit_quiz_form").hasClass('last_page'));
        var thisQuestionAnswered = ($("div.question.answered").length > 0);
        var oneAtATime = quizSubmission.oneAtATime;

        var active = (oneAtATime && lastQuizPage && thisQuestionAnswered) || allQuestionsAnswered;

        quizSubmission.toggleActiveButtonState("#submit_quiz_button", active);
      },

      updateQuestionIndicators: function(answer, questionId){
        var listSelector = "#list_" + questionId;
        var questionSelector = "#" + questionId;
        var combinedId = listSelector + ", " + questionSelector;
        var $questionIcon = $(listSelector + " i.placeholder");
        if(answer) {
          $(combinedId).addClass('answered');
          $questionIcon.addClass('icon-check').removeClass('icon-question');
          $questionIcon.find('.icon-text').text(I18n.t('question_answered', "Answered"));
        } else {
          $(combinedId).removeClass('answered');
          $questionIcon.addClass('icon-question').removeClass('icon-check');
          $questionIcon.find('.icon-text').text(I18n.t('question_unanswered', "Haven't Answered Yet"));
        }
      },

      updateNextButtonState: function(id) {
        var $question = $("#" + id);
        quizSubmission.toggleActiveButtonState('button.next-question', $question.hasClass('answered'));
      },
      toggleActiveButtonState: function(selector, primary) {
        var addClass = (primary ? 'btn-primary' : 'btn-secondary');
        var removeClass = (primary ? 'btn-secondary' : 'btn-primary');
        $(selector).addClass(addClass).removeClass(removeClass);
      },
      submitQuiz: function() {
        var action = $('#submit_quiz_button').data('action');
        $('#submit_quiz_form').attr('action', action).submit();
      }
    };
  })();

  $(window).focus(function(evt) {
    quizSubmission.updateSubmission();
  });

  $(window).blur(function(evt) {
    quizSubmission.inBackground = true;
  });

  $(document).mousedown(function(event) {
    lastAnswerSelected = $(event.target).parents(".answer")[0];
  }).keydown(function() {
    lastAnswerSelected = null;
  });

  // fix screenreader focus for links to href="#target"
  $("a[href^='#']").not("a[href='#']").click(function() {
    $($(this).attr('href')).attr('tabindex', -1).focus()
  });

  $(function() {
    autoBlurActiveInput();

    if($("#preview_mode_link").length == 0) {

      var unloadWarned = false;

      window.addEventListener('beforeunload', function(e) {
        if (!quizSubmission.navigatingToRelogin) {
          if(!quizSubmission.submitting && !quizSubmission.alreadyAcceptedNavigatingAway && !unloadWarned) {
            quizSubmission.clearAccessCode = true
            setTimeout(function() { unloadWarned = false; }, 0);
            unloadWarned = true;
            e.returnValue = I18n.t('confirms.unfinished_quiz', "You're about to leave the quiz unfinished.  Continue anyway?");
            return e.returnValue;
          }
        }
      });
      window.addEventListener('unload', function(e) {
        var data = $("#submit_quiz_form").getFormData();
        var url = $(".backup_quiz_submission_url").attr('href');

        data.leaving = !!quizSubmission.clearAccessCode;

        $.flashMessage(I18n.t('Saving...'));
        $.ajax({
          url,
          data,
          type: 'POST',
          dataType: 'json',
          async: false
        });

        // since this is sync, a callback never fires to reset this
        quizSubmission.currentlyBackingUp = false;
      },
      false)

      $(document).delegate('a', 'click', function(event) {
        if($(this).closest('.ui-dialog,.mceToolbar,.ui-selectmenu').length > 0) { return; }

        if($(this).hasClass('no-warning')) {
          quizSubmission.alreadyAcceptedNavigatingAway = true
          return;
        }

        if(!event.isDefaultPrevented()) {
          var url = $(this).attr('href') || "";
          var hashStripped = location.href;
          if(hashStripped.indexOf('#')) {
            hashStripped = hashStripped.substring(0, hashStripped.indexOf('#'));
          }
          if(url.indexOf('#') == 0 || url.indexOf(hashStripped + "#") == 0) {
            return;
          }
          var result = confirm(I18n.t('confirms.navigate_away', "You're about to navigate away from this page.  Continue anyway?"));
          if(!result) {
            event.preventDefault();
          } else {
            quizSubmission.alreadyAcceptedNavigatingAway = true
          }
        }
      });
    }
    var $questions = $("#questions");
    $("#question_list")
      .delegate(".jump_to_question_link", 'click', function(event) {
        event.preventDefault();
        var $obj = $($(this).attr('href'));
        var scrollableSelector = ENV.MOBILE_UI ? '#content' : 'html,body';
        $(scrollableSelector).scrollTo($obj.parent());
        $obj.find(":input:first").focus().select();
      })
      .find(".list_question").bind({
        mouseenter: function(event) {
          var $this = $(this),
              data = $this.data();

          if(!quizSubmission.oneAtATime) {
            data.relatedQuestion || (data.relatedQuestion = $("#" + $this.attr('id').substring(5)));
            data.relatedQuestion.addClass('related');
          }
        },
        mouseleave: function(event) {
          if(!quizSubmission.oneAtATime) {
            var relatedQuestion = $(this).data('relatedQuestion')
            relatedQuestion && relatedQuestion.removeClass('related');
          }
        },
        click: function(event) {
          quizSubmission.clearAccessCode = false
        }
      });

    $questions.find('.group_top,.answer_select').bind({
      mouseenter: function(event) {
        $(this).addClass('hover');
      },
      mouseleave: function(event) {
        $(this).removeClass('hover');
      }
    });

    $('.file-upload-question-holder').each(function(i,el) {
      var $el = $(el);
      var attachID = parseInt($el.find('input.attachment-id').val(), 10);
      var model = new File(ENV.ATTACHMENTS[attachID], {preflightUrl: ENV.UPLOAD_URL});
      var fileUploadView = new FileUploadQuestionView({el: el, model: model});

      if (attachID && attachID !== 0) {
        $el.find('.file-upload-box').addClass('file-upload-box-with-file');
      }

      fileUploadView.on('attachmentManipulationComplete', function () {
        quizSubmission.updateSubmission();
      })

      fileUploadView.render();
    });

    $questions
      .delegate(":checkbox,:radio", 'change', function(event) {
        var $answer = $(this).parents(".answer");
        if (lastAnswerSelected == $answer[0]) {
          quizSubmission.updateSubmission();
        }
      })
      .delegate("label.upload-label", 'mouseup', function(event) {
          quizSubmission.updateSubmission();
      })
      .delegate(":text,textarea,select", 'change', function(event, update) {
        var $this = $(this);
        if ($this.hasClass('numerical_question_input')) {
          var val = parseFloat($this.val().replace(/,/g, ''));
          $this.val(isNaN(val) ? "" : val.toFixed(4).replace(/\.?0+(e.*)?$/,"$1"));
        }
        if ($this.hasClass('precision_question_input')) {
          var val = parseFloat($this.val().replace(/,/g, ''));
          $this.val(isNaN(val) ? "" : val.toPrecision(16).replace(/\.?0+(e.*)?$/,"$1"));
        }
        if (update !== false) {
          quizSubmission.updateSubmission();
        }
      })
      .delegate(".numerical_question_input", {
        keyup: function(event) {
          var $this = $(this);
          var val = $this.val().replace(/,/g, '');
          var $errorBox = $this.data('associated_error_box');

          if (val.match(/^$|^-$/) || !isNaN(parseFloat(val))) {
            if ($errorBox) {
              $this.triggerHandler('click');
            }
          } else {
            if (!$errorBox) {
              $this.errorBox(I18n.t('errors.only_numerical_values', "only numerical values are accepted"));
            }
          }
        }
      })
      .delegate(".flag_question", 'click', function(e) {
        e.preventDefault();
        var $question = $(this).parents(".question");
        $question.toggleClass('marked');
        $(this).attr("aria-checked", $question.hasClass('marked'));
        $("#list_" + $question.attr('id')).toggleClass('marked');

        var markedText;
        if ($("#list_" + $question.attr('id')).hasClass('marked')) {
          markedText = I18n.t('titles.come_back_later', 'You marked this question to come back to later');
        } else {
          markedText = "";
        }
        $("#list_" + $question.attr('id')).find(".marked-status").text(markedText);

        quizSubmission.updateSubmission();
      })
      .delegate(".question_input", 'change', function(event, update, changedMap) {
        var $this = $(this),
            tagName = this.tagName.toUpperCase(),
            id = $this.parents(".question").attr('id'),
            val = "";
        if (tagName == "A") return;
        if (changedMap) { // reduce redundant jquery lookups and other calls
          if (changedMap[id]) return;
          changedMap[id] = true;
        }

        if (tagName == "TEXTAREA") {
          val = RichContentEditor.callOnRCE($this, 'get_code');
          var $tagInstance = $this;
          $this.siblings('.rce_links').find('.toggle_question_content_views_link').click(function(event) {
            event.preventDefault();
            RichContentEditor.callOnRCE($tagInstance, 'toggle');
            //  todo: replace .andSelf with .addBack when JQuery is upgraded.
            $(this).siblings(".toggle_question_content_views_link").andSelf().toggle();
          });
        } else if ($this.attr('type') == "text" || $this.attr('type') == 'hidden') {
          val = $this.val();
        } else if (tagName == "SELECT") {
          var $selects = $this.parents(".question").find("select.question_input");
          val = !$selects.filter(function() { return !$(this).val() }).length;
        } else {
          $this.parents(".question").find(".question_input").each(function() {
            if($(this).attr('checked') || $(this).attr('selected')) {
              val = true;
            }
          });
        }

        quizSubmission.updateQuestionIndicators(val, id);
        quizSubmission.updateFinalSubmitButtonState();
        quizSubmission.updateNextButtonState(id);
      })

    $questions.find(".question_input").trigger('change', [false, {}]);


    $(".hide_time_link").click(function(event) {
      event.preventDefault();
      if($(".time_running").css('visibility') != 'hidden') {
        $(".time_running").css('visibility', 'hidden');
        $(this).text(I18n.t('show_time_link', "Show"));
      } else {
        $(".time_running").css('visibility', 'visible');
        $(this).text(I18n.t('hide_time_link', "Hide"));
      }
    });

    setTimeout(function() {
      $("#question_list .list_question").each(function() {
        var $this = $(this);
        if($this.find(".jump_to_question_link").text() == "Spacer") {
          $this.remove();
        }
      });
    }, 1000);

    // Suppress "<ENTER>" key from submitting a form when clicked inside a text input.
    $("#submit_quiz_form input[type=text]").keypress(function(e){
      if (e.keyCode == 13)
        return false;
    });

    $(".quiz_submit").click(function(event) {
      quizSubmission.finalSubmitButtonClicked = true;
    });

    $("#submit_quiz_form").submit(function(event) {
      $(".question_holder textarea.question_input").each(function() { $(this).change(); });

      var unanswered;
      var warningMessage;

      if(quizSubmission.cantGoBack) {
        if(!$(".question").hasClass("answered")) {
          warningMessage = I18n.t('confirms.cant_go_back_blank',
            "You can't come back to this question once you hit next. Are you sure you want to leave it blank?");
        }
      }

      if(quizSubmission.finalSubmitButtonClicked) {
        quizSubmission.finalSubmitButtonClicked = false; // reset in case user cancels

        if(quizSubmission.cantGoBack) {
          var unseen = $("#question_list .list_question:not(.seen)").length;
          if(unseen > 0) {
            warningMessage = I18n.t('confirms.unseen_questions',
              {'one': "There is still 1 question you haven't seen yet.  Submit anyway?",
               'other': "There are still %{count} questions you haven't seen yet.  Submit anyway?"},
               {'count': unseen})
          }
        }
        else {
          unanswered = $("#question_list .list_question:not(.answered):not(.text_only)").length;
          if(unanswered > 0) {
            warningMessage = I18n.t('confirms.unanswered_questions',
              {'one': "You have 1 unanswered question (see the right sidebar for details).  Submit anyway?",
               'other': "You have %{count} unanswered questions (see the right sidebar for details).  Submit anyway?"},
               {'count': unanswered});
          }
        }
      }

      if(warningMessage != undefined && !quizSubmission.submitting) {
        var result = confirm(warningMessage);
        if(!result) {
          event.preventDefault();
          event.stopPropagation();
          return false;
        }
      }

      quizSubmission.submitting = true;
    });

    $(".submit_quiz_button").click(function(event) {
      event.preventDefault();
      $("#times_up_dialog").dialog('close');
    });

    setTimeout(function() {
      $(".question_holder textarea.question_input").each(function() {
        $(this).attr('id', 'question_input_' + quizSubmission.contentBoxCounter++);
        RichContentEditor.loadNewEditor($(this), {manageParent: true});
      });
    }, 2000);

    if (quizTakingPolice) {
      quizTakingPolice.addEventListener('message', function(e) {
        if (e.data === 'stopwatchTick') {
          quizSubmission.updateTime();
        }
      });

      quizTakingPolice.postMessage({
        code: 'startStopwatch',
        frequency: quizSubmission.clockInterval
      });

    } else {
      setInterval(quizSubmission.updateTime, quizSubmission.clockInterval);
    }

    setTimeout(function() { quizSubmission.updateSubmission(true) }, 15000);

    var $submit_buttons = $("#submit_quiz_form button[type=submit]");

    // set the form action depending on the button clicked
    $submit_buttons.click(function(event) {
      quizSubmission.clearAccessCode = false;
      var action = $(this).data('action');
      if(action != undefined) {
        $('#submit_quiz_form').attr('action', action);
      }
    });

    // now that JS has been initialized, enable the next and previous buttons
    $submit_buttons.removeAttr('disabled');
  });

  showDeauthorizedDialog = function() {
    $("#deauthorized_dialog").dialog({
      modal: true,
      buttons: [{
        text: I18n.t("#buttons.cancel", "Cancel"),
        'class': "dialog_closer",
        click: function() { $(this).dialog("close"); }
      }, {
        text: I18n.t("#buttons.login", "Login"),
        'class': "btn-primary relogin_button button_type_submit",
        click: function() {
          quizSubmission.navigatingToRelogin = true;
          $('#deauthorized_dialog').submit();
        }
      }]
    });
  };

  if (ENV.LOCKDOWN_BROWSER) {
    var ldbLoginPopup;

    ldbLoginPopup = new LDBLoginPopup();
    ldbLoginPopup
    .on('login_success.take_quiz', function() {
      $.flashMessage(I18n.t('login_successful', 'Login successful.'));
    })
    .on('login_failure.take_quiz', function() {
      $.flashError(I18n.t('login_failed', 'Login failed.'));
    });

    showDeauthorizedDialog = ldbLoginPopup.exec.bind(ldbLoginPopup);
  }

  $(function() {
    var KC_T = 84;
    var $timeRunningTimeRemaining = $(".time_running,.time_remaining");

    // we'll use this buffer to read our updates, then we won't have to steal
    // the user's focus or cursor away, and it will still read instantly thanks
    // to [aria-live="assertive"]!
    //
    // 100% win
    var $timer = $('<div />', {
      'class': 'screenreader-only',
      'aria-role': 'note',
      'aria-live': 'assertive',
      'aria-atomic': 'true',
      'aria-relevant': 'additions'
    }).appendTo(document.body);

    $(document).on('keydown.timer_quickjump', function readTimeLeft(e) {
      if (e.altKey && (e.shiftKey || e.ctrlKey) && e.which === KC_T) {
        e.preventDefault();
        $timer.text($timeRunningTimeRemaining.text());
      }
    });
    if(ENV.QUIZ_SUBMISSION_EVENTS_URL) {
      QuizLogAuditing.start();
      QuizLogAuditingEventDumper(false);
    }
  });

  $( document ).ready(function() {
    $('.loaded').show();
    $('.loading').hide();
  });

  if (!ENV.use_rce_enhancements) {
    $('.essay_question .answers .rce_links').append((new KeyboardShortcuts()).render().el);
  }
