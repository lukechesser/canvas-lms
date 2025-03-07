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
import {number, shape, string} from 'prop-types'

export const Rating = {
  fragment: gql`
    fragment Rating on Rating {
      id
      description
      long_description: longDescription
      points
    }
  `,

  shape: shape({
    id: string.isRequired,
    description: string.isRequired,
    long_description: string,
    points: number
  })
}

export const RatingDefaultMocks = {
  Rating: () => ({
    id: '1',
    description: 'Full Marks',
    longDescription: 'You earned full marks',
    points: 5
  })
}
