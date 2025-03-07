#
# Copyright (C) 2017 - present Instructure, Inc.
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

module Types
  class RubricType < ApplicationObjectType
    graphql_name 'Rubric'

    global_id_field :id
    field :_id, ID, 'legacy canvas id', method: :id, null: false
    field :context_id, String, null: false

    field :criteria, [CriterionType], null: false
    def criteria
      object.data
    end

    field :free_form_criterion_comments, Boolean, null: true
    field :points_possible, Int, null: false
    field :title, String, null: false
  end
end
