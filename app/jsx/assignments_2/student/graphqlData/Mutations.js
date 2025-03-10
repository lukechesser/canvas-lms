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
import gql from 'graphql-tag'

import {Error} from './Error'
import {Submission} from './Submission'
import {SubmissionComment} from './SubmissionComment'
import {SubmissionDraft} from './SubmissionDraft'

export const CREATE_SUBMISSION = gql`
  mutation CreateSubmission(
    $assignmentLid: ID!
    $submissionID: ID!
    $type: OnlineSubmissionType!
    $fileIds: [ID!]
  ) {
    createSubmission(
      input: {assignmentId: $assignmentLid, submissionType: $type, fileIds: $fileIds}
    ) {
      submission {
        ...Submission
      }
      errors {
        ...Error
      }
    }
  }
  ${Error.fragment}
  ${Submission.fragment}
`

export const CREATE_SUBMISSION_COMMENT = gql`
  mutation CreateSubmissionComment(
    $id: ID!
    $submissionAttempt: Int!
    $comment: String!
    $fileIds: [ID!]
  ) {
    createSubmissionComment(
      input: {submissionId: $id, attempt: $submissionAttempt, comment: $comment, fileIds: $fileIds}
    ) {
      submissionComment {
        ...SubmissionComment
      }
      errors {
        ...Error
      }
    }
  }
  ${Error.fragment}
  ${SubmissionComment.fragment}
`

export const CREATE_SUBMISSION_DRAFT = gql`
  mutation CreateSubmissionDraft($id: ID!, $attempt: Int!, $body: String, $fileIds: [ID!]) {
    createSubmissionDraft(
      input: {submissionId: $id, attempt: $attempt, body: $body, fileIds: $fileIds}
    ) {
      submissionDraft {
        ...SubmissionDraft
      }
      errors {
        ...Error
      }
    }
  }
  ${Error.fragment}
  ${SubmissionDraft.fragment}
`
