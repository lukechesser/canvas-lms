#
# Copyright (C) 2011 - present Instructure, Inc.
#
# This file is part of Canvas.
#
# Canvas is free software: you can redistribute it and/or modify it under
# the terms of the GNU Affero General Public License as published by the Free
# Software Foundation, version 3 of the License.
#
# Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
# A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
# details.
#
# You should have received a copy of the GNU Affero General Public License along
# with this program. If not, see <http://www.gnu.org/licenses/>.
#

class GradebooksController < ApplicationController
  include ActionView::Helpers::NumberHelper
  include GradebooksHelper
  include KalturaHelper
  include Api::V1::AssignmentGroup
  include Api::V1::GroupCategory
  include Api::V1::Submission
  include Api::V1::CustomGradebookColumn
  include Api::V1::Section
  include Api::V1::Rubric
  include Api::V1::RubricAssessment

  before_action :require_context
  before_action :require_user, only: [:speed_grader, :speed_grader_settings, :grade_summary]

  batch_jobs_in_actions :only => :update_submission, :batch => { :priority => Delayed::LOW_PRIORITY }

  add_crumb(proc { t '#crumbs.grades', "Grades" }) { |c| c.send :named_context_url, c.instance_variable_get("@context"), :context_grades_url }
  before_action { |c| c.active_tab = "grades" }

  MAX_POST_GRADES_TOOLS = 10

  def grade_summary
    set_current_grading_period if grading_periods?
    @presenter = grade_summary_presenter
    student_enrollment = @presenter.student_enrollment
    # do this as the very first thing, if the current user is a
    # teacher in the course and they are not trying to view another
    # user's grades, redirect them to the gradebook
    if @presenter.user_needs_redirection?
      return redirect_to polymorphic_url([@context, 'gradebook'])
    end

    if !@presenter.student || !student_enrollment
      return render_unauthorized_action
    end

    return unless authorized_action(@context, @current_user, :read) &&
      authorized_action(student_enrollment, @current_user, :read_grades)

    log_asset_access([ "grades", @context ], "grades", "other")

    return render :grade_summary_list unless @presenter.student

    add_crumb(@presenter.student_name, named_context_url(@context, :context_student_grades_url,
                                                         @presenter.student_id))

    js_bundle :grade_summary, :rubric_assessment
    css_bundle :grade_summary

    @google_analytics_page_title = t("Grades for Student")
    render stream: can_stream_template?
  end

  def load_grade_summary_data
    gp_id = nil
    if grading_periods?
      @grading_periods = active_grading_periods_json
      gp_id = @current_grading_period_id unless view_all_grading_periods?

      effective_due_dates =
        Submission.active.
          where(user_id: @presenter.student_id, assignment_id: @context.assignments.active).
          select(:cached_due_date, :grading_period_id, :assignment_id, :user_id).
          each_with_object({}) do |submission, hsh|
          hsh[submission.assignment_id] = {
            submission.user_id => {
              due_at: submission.cached_due_date,
              grading_period_id: submission.grading_period_id,
            }
          }
        end
    end

    @exclude_total = exclude_total?(@context)

    Shackles.activate(:slave) do
      # run these queries on the slave database for speed
      @presenter.assignments
      aggregate_assignments
      @presenter.submissions
      @presenter.assignment_stats
    end

    submissions_json = @presenter.submissions.map do |submission|
      json = {
        assignment_id: submission.assignment_id
      }

      if submission.user_can_read_grade?(@current_user)
        json.merge!({
          excused: submission.excused?,
          score: submission.score,
          workflow_state: submission.workflow_state
        })
      end

      json
    end

    grading_period = @grading_periods && @grading_periods.find { |period| period[:id] == gp_id }

    ags_json = light_weight_ags_json(@presenter.groups, {student: @presenter.student})

    js_hash = {
      submissions: submissions_json,
      assignment_groups: ags_json,
      assignment_sort_options: @presenter.sort_options,
      group_weighting_scheme: @context.group_weighting_scheme,
      show_total_grade_as_points: @context.show_total_grade_as_points?,
      grading_scheme: @context.grading_standard_or_default.data,
      current_grading_period_id: @current_grading_period_id,
      current_assignment_sort_order: @presenter.assignment_order,
      grading_period_set: grading_period_group_json,
      grading_period: grading_period,
      grading_periods: @grading_periods,
      courses_with_grades: courses_with_grades_json,
      effective_due_dates: effective_due_dates,
      exclude_total: @exclude_total,
      gradebook_non_scoring_rubrics_enabled: @context.root_account.feature_enabled?(:non_scoring_rubrics),
      rubric_assessments: rubric_assessments_json(@presenter.rubric_assessments, @current_user, session, style: 'full'),
      rubrics: rubrics_json(@presenter.rubrics, @current_user, session, style: 'full'),
      save_assignment_order_url: course_save_assignment_order_url(@context),
      student_outcome_gradebook_enabled: @context.feature_enabled?(:student_outcome_gradebook),
      student_id: @presenter.student_id,
      students: @presenter.students.as_json(include_root: false),
      outcome_proficiency: outcome_proficiency,
      post_policies_enabled: @context.post_policies_enabled?
    }

    if @context.feature_enabled?(:final_grades_override)
      total_score = if grading_periods? && !view_all_grading_periods?
                      @presenter.student_enrollment.find_score(grading_period_id: @current_grading_period_id)
                    else
                      @presenter.student_enrollment.find_score(course_score: true)
                    end

      js_hash[:effective_final_score] = total_score.effective_final_score if total_score&.overridden?
    end

    js_env(js_hash)
  end
  helper_method :load_grade_summary_data

  def save_assignment_order
    if authorized_action(@context, @current_user, :read)
      whitelisted_orders = {
        'due_at' => :due_at, 'title' => :title,
        'module' => :module, 'assignment_group' => :assignment_group
      }
      assignment_order = whitelisted_orders.fetch(params.fetch(:assignment_order), :due_at)
      @current_user.preferences[:course_grades_assignment_order] ||= {}
      @current_user.preferences[:course_grades_assignment_order][@context.id] = assignment_order
      @current_user.save!
        redirect_back(fallback_location: course_grades_url(@context))
    end
  end

  def light_weight_ags_json(assignment_groups, opts={})
    assignment_groups.map do |ag|
      visible_assignments = ag.visible_assignments(opts[:student] || @current_user).to_a

      if grading_periods? && @current_grading_period_id && !view_all_grading_periods?
        current_period = GradingPeriod.for(@context).find_by(id: @current_grading_period_id)
        visible_assignments = current_period.assignments_for_student(visible_assignments, opts[:student])
      end

      visible_assignments.map! do |a|
        {
          id: a.id,
          submission_types: a.submission_types_array,
          points_possible: a.points_possible,
          due_at: a.due_at,
          omit_from_final_grade: a.omit_from_final_grade?,
          muted: a.muted?
        }
      end

      {
        id: ag.id,
        rules: ag.rules_hash({stringify_json_ids: true}),
        group_weight: ag.group_weight,
        assignments: visible_assignments,
      }
    end
  end

  def grading_rubrics
    @rubric_contexts = @context.rubric_contexts(@current_user)
    if params[:context_code]
      context = @rubric_contexts.detect{|r| r[:context_code] == params[:context_code] }
      @rubric_context = @context
      if context
        @rubric_context = Context.find_by_asset_string(params[:context_code])
      end
      @rubric_associations = @rubric_context.shard.activate { Context.sorted_rubrics(@current_user, @rubric_context) }
      data = @rubric_associations.map{ |ra|
        json = ra.as_json(methods: [:context_name], include: {:rubric => {:include_root => false}})
        # return shard-aware context codes
        json["rubric_association"]["context_code"] = ra.context.asset_string
        json["rubric_association"]["rubric"]["context_code"] = ra.rubric.context.asset_string
        json
      }
      render :json => StringifyIds.recursively_stringify_ids(data)
    else
      render :json => @rubric_contexts
    end
  end

  def show
    if authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])
      @last_exported_gradebook_csv = GradebookCsv.last_successful_export(course: @context, user: @current_user)
      set_current_grading_period if grading_periods?
      set_gradebook_env
      set_tutorial_js_env
      @course_is_concluded = @context.completed?
      @post_grades_tools = post_grades_tools

      render_gradebook
    end
  end

  def post_grades_ltis
    @post_grades_ltis ||= self.external_tools.map { |tool| external_tool_detail(tool) }
  end

  def post_grades_tools
    tool_limit = @context.feature_enabled?(:post_grades) ? MAX_POST_GRADES_TOOLS - 1 : MAX_POST_GRADES_TOOLS
    tools = post_grades_ltis[0...tool_limit]
    tools.push(type: :post_grades) if @context.feature_enabled?(:post_grades) && tools.size == 0
    tools
  end

  def external_tool_detail(tool)
    post_grades_placement = tool[:placements][:post_grades]
    {
      id: tool[:definition_id],
      data_url: post_grades_placement[:canvas_launch_url],
      name: tool[:name],
      type: :lti,
      data_width: post_grades_placement[:launch_width],
      data_height: post_grades_placement[:launch_height]
    }
  end

  def external_tools
    bookmarked_collection = Lti::AppLaunchCollator.bookmarked_collection(@context, [:post_grades])
    tools = bookmarked_collection.paginate(per_page: MAX_POST_GRADES_TOOLS + 1).to_a
    launch_definitions = Lti::AppLaunchCollator.launch_definitions(tools, [:post_grades])
    launch_definitions.each do |launch_definition|
      case launch_definition[:definition_type]
      when 'ContextExternalTool'
        url = external_tool_url_for_lti1(launch_definition)
      when 'Lti::MessageHandler'
        url = external_tool_url_for_lti2(launch_definition)
      end
      launch_definition[:placements][:post_grades][:canvas_launch_url] = url
    end
    launch_definitions
  end

  def external_tool_url_for_lti1(launch_definition)
    polymorphic_url(
      [@context, :external_tool],
      id: launch_definition[:definition_id],
      display: 'borderless',
      launch_type: 'post_grades',
    )
  end

  def external_tool_url_for_lti2(launch_definition)
    polymorphic_url(
      [@context, :basic_lti_launch_request],
      message_handler_id: launch_definition[:definition_id],
      display: 'borderless',
    )
  end

  def set_current_grading_period
    if params[:grading_period_id].present?
      @current_grading_period_id = params[:grading_period_id].to_i
    else
      return if view_all_grading_periods?
      current = GradingPeriod.current_period_for(@context)
      @current_grading_period_id = current ? current.id : 0
    end
  end

  def view_all_grading_periods?
    @current_grading_period_id == 0
  end

  def grading_period_group
    return @grading_period_group if defined? @grading_period_group

    @grading_period_group = active_grading_periods.first&.grading_period_group
  end

  def active_grading_periods
    @active_grading_periods ||= GradingPeriod.for(@context).order(:start_date)
  end

  def grading_period_group_json
    return @grading_period_group_json if defined? @grading_period_group_json
    return @grading_period_group_json = nil unless grading_period_group.present?

    @grading_period_group_json = grading_period_group
      .as_json
      .fetch(:grading_period_group)
      .merge(grading_periods: active_grading_periods_json)
  end

  def active_grading_periods_json
    @agp_json ||= GradingPeriod.periods_json(active_grading_periods, @current_user)
  end

  def old_gradebook_env
    @gradebook_is_editable = @context.grants_right?(@current_user, session, :manage_grades)
    per_page = Setting.get('api_max_per_page', '50').to_i
    teacher_notes = @context.custom_gradebook_columns.not_deleted.where(teacher_notes: true).first
    ag_includes = [:assignments, :assignment_visibility, :grades_published]
    last_exported_attachment = @last_exported_gradebook_csv.try(:attachment)
    grading_standard = @context.grading_standard_or_default
    {
      GRADEBOOK_OPTIONS: {
        api_max_per_page: per_page,
        chunk_size: Setting.get('gradebook2.submissions_chunk_size', '10').to_i,
        assignment_groups_url: api_v1_course_assignment_groups_url(
          @context,
          include: ag_includes,
          override_assignment_dates: "false",
          exclude_assignment_submission_types: ['wiki_page']
        ),
        context_modules_url: api_v1_course_context_modules_url(@context),
        sections_url: api_v1_course_sections_url(@context),
        course_url: api_v1_course_url(@context),
        effective_due_dates_url: api_v1_course_effective_due_dates_url(@context),
        enrollments_url: custom_course_enrollments_api_url(per_page: per_page),
        enrollments_with_concluded_url:
          custom_course_enrollments_api_url(include_concluded: true, per_page: per_page),
        enrollments_with_inactive_url:
          custom_course_enrollments_api_url(include_inactive: true, per_page: per_page),
        enrollments_with_concluded_and_inactive_url:
          custom_course_enrollments_api_url(include_concluded: true, include_inactive: true, per_page: per_page),
        students_url: custom_course_users_api_url(per_page: per_page),
        students_stateless_url: custom_course_users_api_url(exclude_states: true, per_page: per_page),
        students_with_concluded_enrollments_url:
          custom_course_users_api_url(include_concluded: true, per_page: per_page),
        students_with_inactive_enrollments_url:
          custom_course_users_api_url(include_inactive: true, per_page: per_page),
        students_with_concluded_and_inactive_enrollments_url:
          custom_course_users_api_url(include_concluded: true, include_inactive: true, per_page: per_page),
        submissions_url: api_v1_course_student_submissions_url(@context, grouped: '1'),
        outcome_links_url: api_v1_course_outcome_group_links_url(@context, outcome_style: :full),
        outcome_rollups_url: api_v1_course_outcome_rollups_url(@context, per_page: 100),
        change_grade_url:
          api_v1_course_assignment_submission_url(@context, ":assignment", ":submission", include: [:visibility]),
        context_url: named_context_url(@context, :context_url),
        download_assignment_submissions_url:
          named_context_url(@context, :context_assignment_submissions_url, "{{ assignment_id }}", zip: 1),
        re_upload_submissions_url:
          named_context_url(@context, :submissions_upload_context_gradebook_url, "{{ assignment_id }}"),
        context_id: @context.id.to_s,
        context_code: @context.asset_string,
        context_sis_id: @context.sis_source_id,
        group_weighting_scheme: @context.group_weighting_scheme,
        grading_standard: @context.grading_standard_enabled? && grading_standard.data,
        default_grading_standard: grading_standard.data,
        course_is_concluded: @context.completed?,
        course_name: @context.name,
        gradebook_is_editable: @gradebook_is_editable,
        context_allows_gradebook_uploads: @context.allows_gradebook_uploads?,
        gradebook_import_url: new_course_gradebook_upload_path(@context),
        setting_update_url: api_v1_course_settings_url(@context),
        show_total_grade_as_points: @context.show_total_grade_as_points?,
        publish_to_sis_enabled: (
          !!@context.sis_source_id && @context.allows_grade_publishing_by(@current_user) && @gradebook_is_editable
        ),
        publish_to_sis_url: context_url(@context, :context_details_url, anchor: 'tab-grade-publishing'),
        speed_grader_enabled: @context.allows_speed_grader?,
        active_grading_periods: active_grading_periods_json,
        grading_period_set: grading_period_group_json,
        current_grading_period_id: @current_grading_period_id,
        outcome_gradebook_enabled: @context.feature_enabled?(:outcome_gradebook),
        custom_columns_url: api_v1_course_custom_gradebook_columns_url(@context),
        custom_column_url: api_v1_course_custom_gradebook_column_url(@context, ":id"),
        custom_column_data_url: api_v1_course_custom_gradebook_column_data_url(@context, ":id", per_page: per_page),
        custom_column_datum_url: api_v1_course_custom_gradebook_column_datum_url(@context, ":id", ":user_id"),
        reorder_custom_columns_url: api_v1_custom_gradebook_columns_reorder_url(@context),
        teacher_notes: teacher_notes && custom_gradebook_column_json(teacher_notes, @current_user, session),
        change_gradebook_version_url: context_url(
          @context,
          :change_gradebook_version_context_gradebook_url,
          version: 2
        ),
        export_gradebook_csv_url: course_gradebook_csv_url,
        gradebook_csv_progress: @last_exported_gradebook_csv.try(:progress),
        attachment_url: authenticated_download_url(last_exported_attachment),
        attachment: last_exported_attachment,
        sis_app_url: Setting.get('sis_app_url', nil),
        sis_app_token: Setting.get('sis_app_token', nil),
        list_students_by_sortable_name_enabled: @context.list_students_by_sortable_name?,
        gradebook_column_size_settings: @current_user.preferences[:gradebook_column_size],
        gradebook_column_size_settings_url: change_gradebook_column_size_course_gradebook_url,
        gradebook_column_order_settings: @current_user.preferences[:gradebook_column_order].try(:[], @context.id),
        gradebook_column_order_settings_url: save_gradebook_column_order_course_gradebook_url,
        post_grades_ltis: post_grades_ltis,
        post_grades_feature: post_grades_feature?,
        sections: sections_json(@context.active_course_sections, @current_user, session, [], allow_sis_ids: true),
        settings_update_url: api_v1_course_gradebook_settings_update_url(@context),
        settings: gradebook_settings.fetch(@context.id, {}),
        student_groups: group_categories_json(@context.group_categories, @current_user, session, {include: ['groups']}),
        login_handle_name: @context.root_account.settings[:login_handle_name],
        sis_name: @context.root_account.settings[:sis_name],
        version: params.fetch(:version, nil),
        outcome_proficiency: outcome_proficiency
      }
    }
  end

  def set_gradebook_env
    set_student_context_cards_js_env
    env = old_gradebook_env

    if new_gradebook_enabled?
      env = env.deep_merge(new_gradebook_env)
    end

    js_env(env)
  end

  def post_grades_feature?
    @context.feature_enabled?(:post_grades) &&
    @context.allows_grade_publishing_by(@current_user) &&
    can_do(@context, @current_user, :manage_grades)
  end

  def history
    if authorized_action(@context, @current_user, %i[manage_grades view_all_grades])
      crumbs.delete_if { |crumb| crumb[0] == "Grades" }
      add_crumb(t("Gradebook History"),
                context_url(@context, controller: :gradebooks, action: :history))
      @page_title = t("Gradebook History")
      @body_classes << "full-width padless-content"
      js_bundle :gradebook_history
      js_env(
        COURSE_IS_CONCLUDED: @context.is_a?(Course) && @context.completed?
      )

      render html: "", layout: true
    end
  end

  def update_submission
    if authorized_action(@context, @current_user, :manage_grades)
      if params[:submissions].blank? && params[:submission].blank?
        render nothing: true, status: 400
        return
      end

      submissions = if params[:submissions]
        params[:submissions].values.map { |s| ActionController::Parameters.new(s) }
      else
        [params[:submission]]
      end

      # decorate submissions with user_ids if not present
      submissions_without_user_ids = submissions.select {|s| s[:user_id].blank?}
      if submissions_without_user_ids.present?
        submissions = populate_user_ids(submissions_without_user_ids)
      end

      valid_user_ids = Set.new(@context.students_visible_to(@current_user, include: :inactive).pluck(:id))
      submissions.select! { |submission| valid_user_ids.include? submission[:user_id].to_i }

      user_ids = submissions.map { |submission| submission[:user_id] }
      assignment_ids = submissions.map { |submission| submission[:assignment_id] }
      users = @context.admin_visible_students.distinct.find(user_ids).index_by(&:id)
      assignments = @context.assignments.active.find(assignment_ids).index_by(&:id)

      request_error_status = nil
      error = nil
      @submissions = []
      submissions.each do |submission|
        @assignment = assignments[submission[:assignment_id].to_i]
        @user = users[submission[:user_id].to_i]

        submission = submission.permit(:grade, :score, :excuse, :excused,
          :graded_anonymously, :provisional, :final,
          :comment, :media_comment_id, :media_comment_type, :group_comment).to_unsafe_h

        submission[:grader] = @current_user
        submission.delete(:provisional) unless @assignment.moderated_grading?
        if params[:attachments]
          submission[:comment_attachments] = params[:attachments].keys.map do |idx|
            attachment_json = params[:attachments][idx].permit(Attachment.permitted_attributes)
            attachment_json[:user] = @current_user
            attachment = @assignment.attachments.new(attachment_json.except(:uploaded_data))
            Attachments::Storage.store_for_attachment(attachment, attachment_json[:uploaded_data])
            attachment.save!
            attachment
          end
        end
        begin
          if [:grade, :score, :excuse, :excused].any? { |k| submission.key? k }
            # if it's a percentage graded assignment, we need to ensure there's a
            # percent sign on the end. eventually this will probably be done in
            # the javascript.
            if @assignment.grading_type == "percent" && submission[:grade] && submission[:grade] !~ /%\z/
              submission[:grade] = "#{submission[:grade]}%"
            end

            submission[:dont_overwrite_grade] = value_to_boolean(params[:dont_overwrite_grades])
            submission.delete(:final) if submission[:final] && !@assignment.permits_moderation?(@current_user)
            subs = @assignment.grade_student(@user, submission)
            apply_provisional_grade_filters!(submissions: subs, final: submission[:final]) if submission[:provisional]
            @submissions += subs
          end
          if [:comment, :media_comment_id, :comment_attachments].any? { |k| submission.key? k }
            submission[:commenter] = @current_user
            submission[:hidden] = @assignment.muted?

            subs = @assignment.update_submission(@user, submission)
            apply_provisional_grade_filters!(submissions: subs, final: submission[:final]) if submission[:provisional]
            @submissions += subs
          end
        rescue Assignment::GradeError => e
          logger.info "GRADES: grade_student failed because '#{e.message}'"
          error = e
        end
      end
      @submissions = @submissions.reverse.uniq.reverse
      @submissions = nil if submissions.empty?  # no valid submissions

      respond_to do |format|
        if @submissions && error.nil?
          flash[:notice] = t('notices.updated', 'Assignment submission was successfully updated.')
          format.html { redirect_to course_gradebook_url(@assignment.context) }
          format.json do
            render(
              json: submissions_json(submissions: @submissions, assignments: assignments),
              status: :created,
              location: course_gradebook_url(@assignment.context)
            )
          end
          format.text do
            render(
              json: submissions_json(submissions: @submissions, assignments: assignments),
              status: :created,
              location: course_gradebook_url(@assignment.context),
              as_text: true
            )
          end
        else
          error_message = error&.to_s
          flash[:error] = t(
            'errors.submission_failed',
            "Submission was unsuccessful: %{error}",
            error: error_message || t('errors.submission_failed_default', 'Submission Failed')
          )
          request_error_status = error&.status_code || :bad_request

          error_json = {base: error_message}
          error_json[:error_code] = error.error_code if error

          format.html { render :show, course_id: @assignment.context.id }
          format.json { render json: { errors: error_json }, status: request_error_status }
          format.text { render json: { errors: error_json }, status: request_error_status }
        end
      end
    end
  end

  def submissions_json(submissions:, assignments:)
    submissions.map do |submission|
      assignment = assignments[submission[:assignment_id].to_i]
      omitted_field = assignment.anonymize_students? ? :user_id : :anonymous_id
      json_params = {
        include: { submission_history: { methods: %i[late missing], except: omitted_field } },
        except: [omitted_field, :submission_comments]
      }
      json = submission.as_json(Submission.json_serialization_full_parameters.merge(json_params))

      json[:submission].tap do |submission_json|
        submission_json[:assignment_visible] = submission.assignment_visible_to_user?(submission.user)
        submission_json[:provisional_grade_id] = submission.provisional_grade_id if submission.provisional_grade_id
        submission_json[:submission_comments] = anonymous_moderated_submission_comments_json(
          assignment: submission.assignment,
          avatars: service_enabled?(:avatars),
          submissions: submissions,
          submission_comments: submission.visible_submission_comments_for(@current_user),
          current_user: @current_user,
          course: @context
        ).map { |c| {submission_comment: c} }
      end
      json
    end
  end

  def submissions_zip_upload
    return unless authorized_action(@context, @current_user, :manage_grades)
    unless @context.allows_gradebook_uploads?
      flash[:error] = t('errors.not_allowed', "This course does not allow score uploads.")
      redirect_to named_context_url(@context, :context_assignment_url, @assignment.id)
      return
    end
    @assignment = @context.assignments.active.find(params[:assignment_id])
    if !params[:submissions_zip] || params[:submissions_zip].is_a?(String)
      flash[:error] = t('errors.missing_file', "Could not find file to upload")
      redirect_to named_context_url(@context, :context_assignment_url, @assignment.id)
      return
    end
    @comments, @failures = @assignment.generate_comments_from_files(params[:submissions_zip].path, @current_user)
    flash[:notice] = t('notices.uploaded',
                       { :one => "Files and comments created for 1 submission",
                         :other => "Files and comments created for %{count} submissions" },
                       :count => @comments.length)
  end

  def speed_grader
    if !@context.allows_speed_grader?
      flash[:notice] = t(:speed_grader_disabled, 'SpeedGrader is disabled for this course')
      return redirect_to(course_gradebook_path(@context))
    end

    return unless authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])

    @assignment = @context.assignments.active.find(params[:assignment_id])

    if @assignment.unpublished?
      flash[:notice] = t(:speedgrader_enabled_only_for_published_content,
                         'SpeedGrader is enabled only for published content.')
      return redirect_to polymorphic_url([@context, @assignment])
    end

    if @assignment.moderated_grading? && !@assignment.user_is_moderation_grader?(@current_user)
      @assignment.create_moderation_grader(@current_user, occupy_slot: false)
    end

    @can_comment_on_submission = !@context.completed? && !@context_enrollment.try(:completed?)
    @disable_unmute_assignment = @assignment.muted && !@assignment.grades_published?
    respond_to do |format|

      format.html do
        rubric = @assignment&.rubric_association&.rubric
        @headers = false
        @outer_frame = true
        log_asset_access([ "speed_grader", @context ], "grades", "other")
        env = {
          MANAGE_GRADES: @context.grants_right?(@current_user, session, :manage_grades),
          READ_AS_ADMIN: @context.grants_right?(@current_user, session, :read_as_admin),
          CONTEXT_ACTION_SOURCE: :speed_grader,
          can_view_audit_trail: @assignment.can_view_audit_trail?(@current_user),
          settings_url: speed_grader_settings_course_gradebook_path,
          new_gradebook_enabled: new_gradebook_enabled?,
          force_anonymous_grading: force_anonymous_grading?(@assignment),
          anonymous_identities: @assignment.anonymous_grader_identities_by_anonymous_id,
          grading_role: grading_role(assignment: @assignment),
          grading_type: @assignment.grading_type,
          lti_retrieve_url: retrieve_course_external_tools_url(
            @context.id, assignment_id: @assignment.id, display: 'borderless'
          ),
          course_id: @context.id,
          assignment_id: @assignment.id,
          assignment_title: @assignment.title,
          rubric: rubric ? rubric_json(rubric, @current_user, session, style: 'full') : nil,
          nonScoringRubrics: @domain_root_account.feature_enabled?(:non_scoring_rubrics),
          outcome_extra_credit_enabled: @context.feature_enabled?(:outcome_extra_credit),
          can_comment_on_submission: @can_comment_on_submission,
          show_help_menu_item: show_help_link?,
          help_url: help_link_url,
          outcome_proficiency: outcome_proficiency,
        }
        if grading_role(assignment: @assignment) == :moderator
          env[:provisional_select_url] = api_v1_select_provisional_grade_path(@context.id, @assignment.id, "{{provisional_grade_id}}")
        end

        unless @assignment.grades_published? || @assignment.can_view_other_grader_identities?(@current_user)
          env[:current_anonymous_id] = @assignment.moderation_graders.find_by!(user_id: @current_user.id).anonymous_id
        end

        if new_gradebook_enabled?
          env[:selected_section_id] = gradebook_settings.dig(@context.id, 'filter_rows_by', 'section_id')
          env[:post_policies_enabled] = true if @context.post_policies_enabled?
          env[:selected_student_group_id] = gradebook_settings.dig(@context.id, 'filter_rows_by', 'student_group_id')
        end

        if @assignment.quiz
          env[:quiz_history_url] = course_quiz_history_path @context.id,
                                                            @assignment.quiz.id,
                                                            :user_id => "{{user_id}}"
        end
        append_sis_data(env)
        js_env(env)

        render :speed_grader, locals: {
          anonymize_students: @assignment.anonymize_students?,
          post_policies_enabled: env[:post_policies_enabled]
        }
      end

      format.json do
        render json: SpeedGrader::Assignment.new(
          @assignment,
          @current_user,
          avatars: service_enabled?(:avatars),
          grading_role: grading_role(assignment: @assignment)
        ).json
      end
    end
  end

  def speed_grader_settings
    if params[:enable_speedgrader_grade_by_question]
      grade_by_question = value_to_boolean(params[:enable_speedgrader_grade_by_question])
      @current_user.preferences[:enable_speedgrader_grade_by_question] = grade_by_question
      @current_user.save!
    end

    if params[:selected_section_id]
      section_to_show = if params[:selected_section_id] == 'all'
        nil
      elsif @context.active_course_sections.exists?(id: params[:selected_section_id])
        params[:selected_section_id]
      end

      settings = gradebook_settings(create_if_missing: true)
      settings.deep_merge!({
        @context.id => {
          'filter_rows_by' => {
            'section_id' => section_to_show
          }
        }
      })

      # Showing a specific section should always display the "Sections" filter
      # in New Gradebook
      ensure_section_view_filter_enabled if section_to_show.present?
      @current_user.save!
    end

    head :ok
  end

  def blank_submission
    @headers = false
  end

  def change_gradebook_column_size
    if authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])
      unless @current_user.preferences.key?(:gradebook_column_size)
        @current_user.preferences[:gradebook_column_size] = {}
      end

      @current_user.preferences[:gradebook_column_size][params[:column_id]] = params[:column_size]
      @current_user.save!
      render json: nil
    end
  end

  def save_gradebook_column_order
    if authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])
      unless @current_user.preferences.key?(:gradebook_column_order)
        @current_user.preferences[:gradebook_column_order] = {}
      end

      @current_user.preferences[:gradebook_column_order][@context.id] = params[:column_order].to_unsafe_h
      @current_user.save!
      render json: nil
    end
  end

  def final_grade_overrides
    return unless authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])

    final_grade_overrides = ::Gradebook::FinalGradeOverrides.new(@context, @current_user)
    render json: { final_grade_overrides: final_grade_overrides.to_h }
  end

  def user_ids
    return unless authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])

    gradebook_user_ids = GradebookUserIds.new(@context, @current_user)
    render json: { user_ids: gradebook_user_ids.user_ids }
  end

  def grading_period_assignments
    return unless authorized_action(@context, @current_user, [:manage_grades, :view_all_grades])

    grading_period_assignments = GradebookGradingPeriodAssignments.new(@context, gradebook_settings)
    render json: { grading_period_assignments: grading_period_assignments.to_h }
  end

  def change_gradebook_version
    @current_user.preferences[:gradebook_version] = params[:version]
    @current_user.save!
    redirect_to polymorphic_url([@context, 'gradebook'])
  end

  def visible_modules?
    @visible_modules ||= @context.modules_visible_to(@current_user).any?
  end
  helper_method :visible_modules?

  def multiple_sections?
    @multiple_sections ||= @context.multiple_sections?
  end
  helper_method :multiple_sections?

  def multiple_assignment_groups?
    @multiple_assignment_groups ||= @context.assignment_groups.many?
  end
  helper_method :multiple_assignment_groups?

  def student_groups?
    return @student_groups if defined?(@student_groups)

    @student_groups = @context.groups.any?
  end
  helper_method :student_groups?

  private

  def outcome_proficiency
    if @context.root_account.feature_enabled?(:non_scoring_rubrics)
      @context.account.resolved_outcome_proficiency&.as_json
    end
  end

  def new_gradebook_env
    graded_late_submissions_exist = @context.submissions.graded.late.exists?

    # Prefer the course setting, but check the user's preferences if the
    # course setting doesn't exist
    # TODO: remove the fallback to user preferences (GRADE-2124)
    allow_final_grade_override = if @context.settings.include?(:allow_final_grade_override)
      @context.allow_final_grade_override?
    else
      user_preference = @current_user.preferences.dig(:gradebook_settings, @context.id, "show_final_grade_overrides")
      value_to_boolean(user_preference)
    end

    visible_sections = @context.sections_visible_to(@current_user)

    new_gradebook_options = {
      colors: gradebook_settings.fetch(:colors, {}),

      course_settings: {
        allow_final_grade_override: allow_final_grade_override,
        filter_speed_grader_by_student_group: @context.filter_speed_grader_by_student_group?
      },

      final_grade_override_enabled: @context.feature_enabled?(:final_grades_override),
      graded_late_submissions_exist: graded_late_submissions_exist,
      gradezilla: true,
      grading_schemes: GradingStandard.for(@context).as_json(include_root: false),
      late_policy: @context.late_policy.as_json(include_root: false),
      new_gradebook_development_enabled: new_gradebook_development_enabled?,
      post_policies_enabled: @context.post_policies_enabled?,
      sections: sections_json(visible_sections, @current_user, session, [], allow_sis_ids: true)
    }
    new_gradebook_options[:post_manually] = @context.post_manually? if @context.post_policies_enabled?

    {GRADEBOOK_OPTIONS: new_gradebook_options}
  end

  def gradebook_version
    # params[:version] is a development-only convenience for engineers.
    # This param should never be used outside of development.
    if Rails.env.development? && params.include?(:version)
      params[:version]
    else
      @current_user.preferred_gradebook_version
    end
  end

  def new_gradebook_enabled?
    # params[:new_gradebook] is a development-only convenience for engineers.
    # This param should never be used outside of development.
    if Rails.env.development? && params.include?(:new_gradebook)
      params[:new_gradebook] == "true"
    else
      @context.feature_enabled?(:new_gradebook)
    end
  end

  def new_gradebook_development_enabled?
    # params[:new_gradebook_development] is a development-only convenience for engineers.
    # This param should never be used outside of development.
    if Rails.env.development? && params.include?(:new_gradebook_development)
      params[:new_gradebook_development] == "true"
    else
      !!ENV['GRADEBOOK_DEVELOPMENT']
    end
  end

  def render_gradebook
    if ["srgb", "individual"].include?(gradebook_version)
      render_individual_gradebook
    else
      render_default_gradebook
    end
  end

  def render_default_gradebook
    if new_gradebook_enabled?
      render "gradebooks/gradezilla/gradebook"
    else
      render :gradebook
    end
  end

  def render_individual_gradebook
    if new_gradebook_enabled?
      render "gradebooks/gradezilla/individual"
    else
      render :screenreader
    end
  end

  def percentage(weight)
    I18n.n(weight, percentage: true)
  end

  def points_possible(weight, options)
    return unless options[:weighting]
    return t("%{weight} of Final", weight: percentage(weight)) if options[:out_of_final]
    percentage(weight)
  end

  def aggregate_by_grading_period?
    view_all_grading_periods? && @context.weighted_grading_periods?
  end

  def aggregate_assignments
    if aggregate_by_grading_period?
      @presenter.periods_assignments = periods_as_assignments(@presenter.grading_periods,
                                                              out_of_final: true,
                                                              exclude_total: @exclude_total)
    else
      @presenter.groups_assignments = groups_as_assignments(@presenter.groups,
                                                            out_of_final: true,
                                                            exclude_total: @exclude_total)
    end
  end

  def groups_as_assignments(groups=nil, options = {})
    as_assignments(
      groups || @context.assignment_groups.active,
      options.merge!(weighting: @context.group_weighting_scheme == 'percent')
    ) { |group| group_as_assignment(group, options) }
  end

  def periods_as_assignments(periods=nil, options = {})
    as_assignments(
      periods || @context.grading_periods.active,
      options.merge!(weighting: @context.weighted_grading_periods?)
    ) { |period| period_as_assignment(period, options) }
  end

  def as_assignments(objects=nil, options={})
    fakes = []
    fakes.concat(objects.map { |object| yield(object) }) if objects && block_given?
    fakes << total_as_assignment(options) unless options[:exclude_total]
    fakes
  end

  def group_as_assignment(group, options)
    OpenObject.build('assignment',
                     id: "group-#{group.id}",
                     rules: group.rules,
                     title: group.name,
                     points_possible: points_possible(group.group_weight, options),
                     hard_coded: true,
                     special_class: 'group_total',
                     assignment_group_id: group.id,
                     group_weight: group.group_weight,
                     asset_string: "group_total_#{group.id}")
  end

  def period_as_assignment(period, options)
    OpenObject.build('assignment',
                     id: "period-#{period.id}",
                     rules: [],
                     title: period.title,
                     points_possible: points_possible(period.weight, options),
                     hard_coded: true,
                     special_class: 'group_total',
                     assignment_group_id: period.id,
                     group_weight: period.weight,
                     asset_string: "period_total_#{period.id}")
  end

  def total_as_assignment(options = {})
    OpenObject.build('assignment',
                     id: 'final-grade',
                     title: t('Total'),
                     points_possible: (options[:out_of_final] ? '' : percentage(100)),
                     hard_coded: true,
                     special_class: 'final_grade',
                     asset_string: "final_grade_column")
  end

  def moderated_grading_enabled_and_no_grades_published?
    @assignment.moderated_grading? && !@assignment.grades_published?
  end

  def exclude_total?(context)
    return true if context.hide_final_grades
    return false unless grading_periods? && view_all_grading_periods?

    grading_period_group.present? && !grading_period_group.display_totals_for_all_grading_periods?
  end

  def grade_summary_presenter
    options = presenter_options
    if options.key?(:grading_period_id)
      GradingPeriodGradeSummaryPresenter.new(@context, @current_user, params[:id], options)
    else
      GradeSummaryPresenter.new(@context, @current_user, params[:id], options)
    end
  end

  def presenter_options
    options = {}
    return options unless @context.present?

    if @current_grading_period_id.present? && !view_all_grading_periods? && grading_periods?
      options[:grading_period_id] = @current_grading_period_id
    end

    return options unless @current_user.present?

    order_preferences = @current_user.preferences[:course_grades_assignment_order]
    saved_order = order_preferences && order_preferences[@context.id]
    options[:assignment_order] = saved_order if saved_order.present?
    options
  end

  def custom_course_users_api_url(include_concluded: false, include_inactive: false, exclude_states: false, per_page:)
    state = %w[active invited]
    state << 'completed' if include_concluded
    state << 'inactive'  if include_inactive
    state = [] if exclude_states

    api_v1_course_users_url(
      @context,
      include: %i[avatar_url group_ids enrollments],
      enrollment_type: %w[student student_view],
      enrollment_state: state,
      per_page: per_page
    )
  end

  def custom_course_enrollments_api_url(include_concluded: false, include_inactive: false, per_page:)
    state = %w[active invited]
    state << 'completed' if include_concluded
    state << 'inactive'  if include_inactive
    api_v1_course_enrollments_url(
      @context,
      include: %i[avatar_url group_ids],
      type: %w[StudentEnrollment StudentViewEnrollment],
      state: state,
      per_page: per_page
    )
  end

  def gradebook_settings(create_if_missing: false)
    preferences = @current_user.preferences
    if !preferences.include?(:gradebook_settings) && create_if_missing
      preferences[:gradebook_settings] = {}
    end

    preferences.fetch(:gradebook_settings, {})
  end

  def ensure_section_view_filter_enabled
    context_settings = gradebook_settings.fetch(@context.id)
    filter_settings = context_settings.fetch('selected_view_options_filters', [])
    return if filter_settings&.include?('sections')

    context_settings['selected_view_options_filters'] = filter_settings.append('sections')
  end

  def courses_with_grades_json
    courses = @presenter.courses_with_grades
    courses << @context if courses.empty?

    courses.map do |course|
      grading_period_set_id = GradingPeriodGroup.for_course(course)&.id

      {
        id: course.id,
        nickname: course.nickname_for(@current_user),
        url: context_url(course, :context_grades_url),
        grading_period_set_id: grading_period_set_id.try(:to_s)
      }
    end.as_json
  end

  def populate_user_ids(submissions)
    anonymous_ids = submissions.map {|submission| submission.fetch(:anonymous_id)}
    submission_ids_map = Submission.select(:user_id, :anonymous_id).
      where(assignment: @context.assignments, anonymous_id: anonymous_ids).
      index_by(&:anonymous_id)

    # merge back into submissions
    submissions.map do |submission|
      submission[:user_id] = submission_ids_map[submission.fetch(:anonymous_id)].user_id
      submission
    end
  end

  def apply_provisional_grade_filters!(submissions:, final:)
    preloaded_grades = ModeratedGrading::ProvisionalGrade.where(submission: submissions)
    grades_by_submission_id = preloaded_grades.group_by(&:submission_id)

    submissions.each do |submission|
      provisional_grade = submission.provisional_grade(
        @current_user,
        preloaded_grades: grades_by_submission_id,
        final: final,
        default_to_null_grade: false
      )
      submission.apply_provisional_grade_filter!(provisional_grade) if provisional_grade
    end
  end

  def grading_role(assignment:)
    if moderated_grading_enabled_and_no_grades_published?
      if assignment.permits_moderation?(@current_user)
        :moderator
      else
        :provisional_grader
      end
    else
      :grader
    end
  end
end
