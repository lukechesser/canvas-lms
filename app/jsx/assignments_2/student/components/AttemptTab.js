/*
 * Copyright (C) 2019 - present Instructure, Inc.
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

import {Assignment} from '../graphqlData/Assignment'
import AssignmentAlert from './AssignmentAlert'
import {CREATE_SUBMISSION, CREATE_SUBMISSION_DRAFT} from '../graphqlData/Mutations'
import FilePreview from './FilePreview'
import FileUpload from './FileUpload'
import I18n from 'i18n!assignments_2_content_upload_tab'
import LoadingIndicator from '../../shared/LoadingIndicator'
import {Mutation} from 'react-apollo'
import React, {Component} from 'react'
import {STUDENT_VIEW_QUERY, SUBMISSION_HISTORIES_QUERY} from '../graphqlData/Queries'
import {Submission} from '../graphqlData/Submission'
import TextEntry from './TextEntry'

export default class AttemptTab extends Component {
  static propTypes = {
    assignment: Assignment.shape,
    submission: Submission.shape
  }

  state = {
    submissionState: null,
    uploadState: null
  }

  updateSubmissionDraftCache = (cache, mutationResult) => {
    const {assignment} = cache.readQuery({
      query: STUDENT_VIEW_QUERY,
      variables: {assignmentLid: this.props.assignment._id, submissionID: this.props.submission.id}
    })

    const newDraft = mutationResult.data.createSubmissionDraft.submissionDraft
    assignment.submissionsConnection.nodes[0].submissionDraft = newDraft

    cache.writeQuery({
      query: STUDENT_VIEW_QUERY,
      variables: {assignmentLid: this.props.assignment._id, submissionID: this.props.submission.id},
      data: {assignment}
    })
  }

  clearSubmissionHistoriesCache = cache => {
    // Clear the submission histories cache so that we don't lose the currently
    // displayed submission when a new submission is created and the current
    // submission gets transitioned over to a submission history.
    //
    // We can't set set the data back to null because apollo doesn't support that:
    // https://github.com/apollographql/apollo-feature-requests/issues/4
    // Instead, setting it to a `blank` state is as close as we can come.
    const node = {
      submissionHistoriesConnection: {
        nodes: [],
        pageInfo: {
          startCursor: null,
          hasPreviousPage: true,
          __typename: 'PageInfo'
        },
        __typename: 'SubmissionHistoryConnection'
      },
      __typename: 'Submission'
    }

    cache.writeQuery({
      query: SUBMISSION_HISTORIES_QUERY,
      variables: {submissionID: this.props.submission.id},
      data: {node}
    })
  }

  updateUploadState = state => {
    this.setState({uploadState: state})
  }

  updateSubmissionState = state => {
    this.setState({submissionState: state})
  }

  renderUploadAlert() {
    if (this.state.uploadState) {
      let errorMessage, successMessage

      if (this.state.uploadState === 'error') {
        errorMessage = I18n.t('Error updating submission draft')
      } else if (this.state.uploadState === 'success') {
        successMessage = I18n.t('Submission draft updated')
      }

      return (
        <AssignmentAlert
          errorMessage={errorMessage}
          successMessage={successMessage}
          onDismiss={() => this.updateUploadState(null)}
        />
      )
    }
  }

  renderSubmissionAlert() {
    if (this.state.submissionState) {
      let errorMessage, successMessage

      if (this.state.submissionState === 'error') {
        errorMessage = I18n.t('Error sending submission')
      } else if (this.state.submissionState === 'success') {
        successMessage = I18n.t('Submission sent')
      }

      return (
        <AssignmentAlert
          errorMessage={errorMessage}
          successMessage={successMessage}
          onDismiss={() => this.updateSubmissionState(null)}
        />
      )
    }
  }

  renderFileUpload = (createSubmission, createSubmissionDraft) => {
    return (
      <FileUpload
        assignment={this.props.assignment}
        createSubmission={createSubmission}
        createSubmissionDraft={createSubmissionDraft}
        submission={this.props.submission}
        updateSubmissionState={this.updateSubmissionState}
        updateUploadState={this.updateUploadState}
      />
    )
  }

  renderFileAttempt = (createSubmission, createSubmissionDraft) => {
    return this.props.submission.state === 'graded' ||
      this.props.submission.state === 'submitted' ? (
      <FilePreview key={this.props.submission.attempt} files={this.props.submission.attachments} />
    ) : (
      this.renderFileUpload(createSubmission, createSubmissionDraft)
    )
  }

  renderTextAttempt = createSubmissionDraft => {
    return (
      <TextEntry
        createSubmissionDraft={createSubmissionDraft}
        submission={this.props.submission}
        updateUploadState={this.updateUploadState}
      />
    )
  }

  renderSubmissionByType = (createSubmission, createSubmissionDraft) => {
    // TODO: we need to ensure we handle multiple submission types eventually
    switch (this.props.assignment.submissionTypes[0]) {
      case 'online_text_entry':
        return this.renderTextAttempt(createSubmissionDraft)
      case 'online_upload':
        return this.renderFileAttempt(createSubmission, createSubmissionDraft)
      default:
        throw new Error('submission type not yet supported in A2')
    }
  }

  renderSubmission = createSubmission => {
    switch (this.state.submissionState) {
      case 'error':
        return this.renderSubmissionAlert()
      case 'in-progress':
        return <LoadingIndicator />
      case 'success':
      default:
        return (
          <React.Fragment>
            {this.renderSubmissionAlert()}
            <Mutation
              mutation={CREATE_SUBMISSION_DRAFT}
              onCompleted={() => this.updateUploadState('success')}
              onError={() => this.updateUploadState('error')}
              update={this.updateSubmissionDraftCache}
            >
              {createSubmissionDraft => (
                <React.Fragment>
                  {this.renderUploadAlert()}
                  {this.renderSubmissionByType(createSubmission, createSubmissionDraft)}
                </React.Fragment>
              )}
            </Mutation>
          </React.Fragment>
        )
    }
  }

  render() {
    return (
      <Mutation
        mutation={CREATE_SUBMISSION}
        onCompleted={() => this.updateSubmissionState('success')}
        onError={() => this.updateSubmissionState('error')}
        update={this.clearSubmissionHistoriesCache}
      >
        {this.renderSubmission}
      </Mutation>
    )
  }
}
